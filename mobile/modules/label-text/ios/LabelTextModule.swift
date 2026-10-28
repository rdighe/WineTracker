import ExpoModulesCore
import ImageIO
import UIKit
import Vision

/// Reads the text on a wine label photo with Apple's Vision framework, on the
/// device: free, offline, and good at the large stylized names on labels. The
/// server matches this text to the catalog and only calls the LLM when it can't.
/// Also reads wine lists, with where each piece of text is on the page.
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
