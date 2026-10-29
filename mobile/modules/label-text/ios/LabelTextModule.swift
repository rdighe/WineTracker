import ExpoModulesCore
import ImageIO
import PDFKit
import UIKit
import Vision

/// Reads the text on a wine label photo with Apple's Vision framework, on the
/// device: free, offline, and good at the large stylized names on labels. The
/// server matches this text to the catalog and only calls the LLM when it can't.
/// Also reads wine lists, with where each piece of text is on the page, and
/// turns a PDF menu's pages into images to read the same way.
public class LabelTextModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LabelText")

    // Lines of text in the image at `uri`, top to bottom.
    AsyncFunction("recognizeTextAsync") { (uri: URL, promise: Promise) in
      recognize(uri, promise) { observations in
        observations
          .sorted { $0.boundingBox.maxY > $1.boundingBox.maxY } // Vision's origin is bottom-left
          .compactMap { $0.topCandidates(1).first }
          .filter { $0.confidence >= 0.3 }
          .map { $0.string }
      }
    }

    // Every piece of text with where it is (0-1, origin top-left), for pages
    // laid out in rows and columns: wine lists, shelf tags.
    AsyncFunction("recognizeTextLayoutAsync") { (uri: URL, promise: Promise) in
      recognize(uri, promise) { observations in
        observations.compactMap { o -> [String: Any]? in
          guard let t = o.topCandidates(1).first, t.confidence >= 0.3 else { return nil }
          let b = o.boundingBox
          return ["text": t.string, "x": Double(b.minX), "y": Double(1 - b.maxY), "w": Double(b.width), "h": Double(b.height)]
        }
      }
    }

    // A PDF's pages (the first `maxPages`) as JPEG files, the longer side
    // `maxSide` pixels: [{ uri, width, height }], plus the page count.
    AsyncFunction("renderPdfPagesAsync") { (uri: URL, maxPages: Int, maxSide: Double, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        guard let doc = PDFDocument(url: uri) else {
          promise.reject("ERR_LABEL_TEXT_PDF", "Could not open the PDF")
          return
        }
        if doc.isLocked {
          promise.reject("ERR_LABEL_TEXT_PDF_LOCKED", "The PDF is password protected")
          return
        }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("pdf-pages-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var pages: [[String: Any]] = []
        for i in 0..<min(doc.pageCount, maxPages) {
          guard let page = doc.page(at: i)?.pageRef else { continue }
          let box = page.getBoxRect(.mediaBox)
          let size = page.rotationAngle % 180 != 0 ? CGSize(width: box.height, height: box.width) : box.size
          guard size.width > 0, size.height > 0 else { continue }
          let scale = CGFloat(maxSide) / max(size.width, size.height)
          let pixels = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
          let format = UIGraphicsImageRendererFormat()
          format.scale = 1
          format.opaque = true
          let image = UIGraphicsImageRenderer(size: pixels, format: format).image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(origin: .zero, size: pixels))
            let cg = ctx.cgContext
            // PDF space is bottom-left: flip, scale up, then the page's own transform (its rotation and box offset).
            cg.translateBy(x: 0, y: pixels.height)
            cg.scaleBy(x: scale, y: -scale)
            cg.concatenate(page.getDrawingTransform(.mediaBox, rect: CGRect(origin: .zero, size: size), rotate: 0, preserveAspectRatio: true))
            cg.drawPDFPage(page)
          }
          let file = dir.appendingPathComponent("page-\(i + 1).jpg")
          guard let data = image.jpegData(compressionQuality: 0.9), (try? data.write(to: file)) != nil else { continue }
          pages.append(["uri": file.absoluteString, "width": Double(pixels.width), "height": Double(pixels.height)])
        }
        promise.resolve(["pages": pages, "pageCount": doc.pageCount])
      }
    }
  }
}

/// Run Vision's text recognizer on the image at `uri` and resolve with what `result` makes of it.
private func recognize(_ uri: URL, _ promise: Promise, _ result: @escaping ([VNRecognizedTextObservation]) -> Any) {
  DispatchQueue.global(qos: .userInitiated).async {
    guard let data = try? Data(contentsOf: uri), let image = UIImage(data: data), let cgImage = image.cgImage else {
      promise.reject("ERR_LABEL_TEXT_IMAGE", "Could not read the image at \(uri.absoluteString)")
      return
    }
    let request = VNRecognizeTextRequest { request, error in
      if let error = error {
        promise.reject("ERR_LABEL_TEXT_VISION", error.localizedDescription)
        return
      }
      promise.resolve(result((request.results as? [VNRecognizedTextObservation]) ?? []))
    }
    request.recognitionLevel = .accurate
    // Producer and cuvee names aren't dictionary words; "correcting" them makes them worse.
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["fr-FR", "en-US", "it-IT", "es-ES", "de-DE", "pt-BR"]
    let handler = VNImageRequestHandler(cgImage: cgImage, orientation: CGImagePropertyOrientation(image.imageOrientation), options: [:])
    do {
      try handler.perform([request])
    } catch {
      promise.reject("ERR_LABEL_TEXT_VISION", error.localizedDescription)
    }
  }
}

private extension CGImagePropertyOrientation {
  init(_ orientation: UIImage.Orientation) {
    switch orientation {
    case .up: self = .up
    case .upMirrored: self = .upMirrored
    case .down: self = .down
    case .downMirrored: self = .downMirrored
    case .left: self = .left
    case .leftMirrored: self = .leftMirrored
    case .right: self = .right
    case .rightMirrored: self = .rightMirrored
    @unknown default: self = .up
    }
  }
}
