import ExpoModulesCore
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Reads the wines and prices on a restaurant wine list with Apple
/// Intelligence's on-device model (the Foundation Models framework): free,
/// private and offline. The phone reads the photo's text first (LabelText);
/// this turns a part of that text into wines. The app sends a long list in
/// parts, since the on-device model takes a few thousand words at a time.
/// Where it can't run, the server reads the text instead (src/llm/prompts.ts,
/// wineListPrompt: the same fields and rules).
///
/// Also reads store shelves from the text of their shelf tags (mode "shelf"),
/// which name each wine and its price; the server reads the photo itself
/// only when this finds nothing.
public class WineListModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WineList")

    AsyncFunction("isAvailableAsync") { () -> Bool in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        return SystemLanguageModel.default.isAvailable
      }
      #endif
      return false
    }

    AsyncFunction("readAsync") { (text: String, heading: String, mode: String) async throws -> [[String: Any]] in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        return try await readList(text, heading: heading, shelf: mode == "shelf")
      }
      #endif
      throw Exception(name: "ERR_WINE_LIST_UNAVAILABLE", description: "Apple Intelligence isn't available on this device")
    }
  }
}

#if canImport(FoundationModels)
@available(iOS 26.0, *)
private let instructions = """
  You read the text of a restaurant wine list, taken from a photo. Each line is about one row of the page; " | " separates \
  text far apart on the same row, which can be two columns of the list.
  List every wine in the text, in order.
  - producer: the winery, house or chateau as printed. name: the rest of the wine's name (cuvée, vineyard, appellation).
  - vintage: the 4-digit year printed for that wine, NV if printed as non-vintage, empty if none. Never guess.
  - region, grape, colour, style: as printed, or certain from the appellation or the heading the wine is under.
  - section: the heading the wine is listed under, empty if none.
  - glassPrice and bottlePrice: the prices as numbers, 0 when not given. A wine with one price: decide from the heading \
  or column ("by the glass") whether it is a glass or a bottle price; a lone price under about 25 is usually a glass.
  - bottleMl: only for half bottles (375), magnums (1500) and other sizes that aren't 750; 0 otherwise.
  - Bin numbers, page numbers, descriptions and food are not wines. Skip cocktails, beer, spirits and sake.
  """

@available(iOS 26.0, *)
private let shelfInstructions = """
  You read the text of a photo of wine on a store shelf: mostly the shelf tags (the price labels on the shelf edge), \
  plus bits of bottle labels. Each line is about one row of the photo; " | " separates text far apart on the same row.
  List every wine that has a shelf tag in the text, in order.
  - producer: the winery as printed. name: the rest of the wine's name (cuvée, grape, appellation). Expand shelf-tag \
  abbreviations: CAB SAUV is Cabernet Sauvignon, CHARD is Chardonnay, PN is Pinot Noir, SB is Sauvignon Blanc.
  - vintage: the 4-digit year printed, NV if non-vintage, empty if none. Never guess.
  - region, grape, colour, style: as printed, or certain from the appellation.
  - section: empty. glassPrice: 0.
  - bottlePrice: the price now for one bottle (a sale price if there is one); not a unit price per ounce or liter, \
  not a case or multi-buy price.
  - bottleMl: the size when it isn't 750 ml (375, 1500, 3000 for boxes); 0 otherwise.
  - Skip spirits, beer and tags that aren't for wine.
  """

@available(iOS 26.0, *)
@Generable
private enum Colour {
  case red, white, rose, orange, unknown
}

@available(iOS 26.0, *)
@Generable
private enum Style {
  case still, sparkling, sweet, fortified, unknown
}

@available(iOS 26.0, *)
@Generable
private struct ListWine {
  var producer: String
  var name: String
  @Guide(description: "4-digit year, NV, or empty")
  var vintage: String
  var region: String
  var grape: String
  var colour: Colour
  var style: Style
  var section: String
  @Guide(description: "Price of a glass; 0 when not given")
  var glassPrice: Double
  @Guide(description: "Price of a bottle; 0 when not given")
  var bottlePrice: Double
  @Guide(description: "Bottle size in ml when not 750; 0 otherwise")
  var bottleMl: Int
}

@available(iOS 26.0, *)
@Generable
private struct ListReading {
  var wines: [ListWine]
}

@available(iOS 26.0, *)
private func readList(_ text: String, heading: String, shelf: Bool) async throws -> [[String: Any]] {
  let session = LanguageModelSession(instructions: shelf ? shelfInstructions : instructions)
  let context = heading.isEmpty ? "" : "This part of the list starts under the heading: \(heading)\n"
  let reply = try await session.respond(
    to: shelf ? "Shelf text:\n\"\"\"\n\(text)\n\"\"\"" : "\(context)Wine list text:\n\"\"\"\n\(text)\n\"\"\"",
    generating: ListReading.self,
    options: GenerationOptions(sampling: .greedy)
  )
  return reply.content.wines.map { w in
    [
      "producer": w.producer, "name": w.name, "vintage": w.vintage, "region": w.region, "grape": w.grape,
      "colour": w.colour == .unknown ? "" : String(describing: w.colour),
      "style": w.style == .unknown ? "" : String(describing: w.style),
      "section": w.section, "glassPrice": w.glassPrice, "bottlePrice": w.bottlePrice, "bottleMl": w.bottleMl,
    ]
  }
}
#endif
