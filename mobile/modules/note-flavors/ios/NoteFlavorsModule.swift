import ExpoModulesCore
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Reads which flavor families a tasting note says a wine has, with Apple
/// Intelligence's on-device model (the Foundation Models framework): free,
/// private and offline. Where it can't run (before iOS 26, an iPhone without
/// Apple Intelligence, or it's turned off) the app leaves notes to the server.
///
/// The same families and rules as the server's prompt (src/llm/prompts.ts,
/// families from src/recs/flavors.ts); test/note-flavors.test.ts checks the cases.
public class NoteFlavorsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NoteFlavors")

    AsyncFunction("isAvailableAsync") { () -> Bool in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        return SystemLanguageModel.default.isAvailable
      }
      #endif
      return false
    }

    // Flavor family -> intensity 1-3.
    AsyncFunction("readAsync") { (text: String) async throws -> [String: Int] in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        return try await readNote(text)
      }
      #endif
      throw Exception(name: "ERR_NOTE_FLAVORS_UNAVAILABLE", description: "Apple Intelligence isn't available on this device")
    }
  }
}

#if canImport(FoundationModels)
@available(iOS 26.0, *)
private let instructions = """
  You read a wine drinker's own tasting note and tags about one wine.
  Say which of these flavor and structure families the drinker says the wine HAS, each with an intensity:
  1 = a hint, 2 = clearly there, 3 = dominant.

  - black_fruit: black fruit (blackberry, blackcurrant, cassis, black cherry, plum)
  - red_fruit: red fruit (cherry, raspberry, strawberry, red currant, cranberry)
  - citrus: citrus (lemon, lime, grapefruit, orange peel, zest)
  - orchard: apple & pear (apple, pear, quince)
  - stone_fruit: stone fruit (peach, apricot, nectarine)
  - tropical: tropical fruit (pineapple, mango, passion fruit, lychee, melon)
  - floral: floral (violet, rose petal, blossom, jasmine, honeysuckle)
  - herbal: herbal (herbs, mint, eucalyptus, green pepper, grass)
  - earthy: earthy (earth, forest floor, mushroom, truffle, leather, tobacco)
  - mineral: mineral (flint, chalk, slate, wet stone, saline)
  - oak: oaky (oak, vanilla, toast, cedar, smoke)
  - spice: spicy (pepper, clove, cinnamon, licorice, baking spice)
  - savory: savory (olive, meaty, bacon, soy, umami)
  - rich_sweet: honeyed (honey, marmalade, candied or dried fruit, caramel, nutty)
  - yeasty: brioche (brioche, bread, biscuit, yeast)
  - tannic: firm tannins (tannic, grippy, structured, firm)
  - fresh: high acidity (crisp, fresh, zesty, bright, racy)
  - full: full-bodied (rich, opulent, powerful, concentrated, bold)
  - light: light & elegant (light-bodied, delicate, elegant, silky)
  - sweet: sweet (sweet, off-dry, luscious, unctuous)

  Rules:
  - Only what the note says. Do not guess from the grape, region or anything you know about the wine.
  - Leave out a family the note says is absent or wished for ("no oak", "not sweet at all", "could use more acidity").
  - Words outside the examples count too ("campfire" is smoke, so oak; "zippy" is high acidity).
  - Nothing about flavor in the note: no families.
  """

@available(iOS 26.0, *)
@Generable
private enum Family {
  case black_fruit, red_fruit, citrus, orchard, stone_fruit, tropical, floral, herbal, earthy, mineral
  case oak, spice, savory, rich_sweet, yeasty, tannic, fresh, full, light, sweet
}

@available(iOS 26.0, *)
@Generable
private struct Mention {
  var family: Family
  @Guide(description: "1 = a hint, 2 = clearly there, 3 = dominant", .range(1...3))
  var intensity: Int
}

@available(iOS 26.0, *)
@Generable
private struct Reading {
  @Guide(description: "The families the note says the wine has; empty when it says nothing about flavor")
  var flavors: [Mention]
}

@available(iOS 26.0, *)
private func readNote(_ text: String) async throws -> [String: Int] {
  let session = LanguageModelSession(instructions: instructions)
  let reply = try await session.respond(
    to: "Note:\n\"\"\"\n\(text.prefix(2000))\n\"\"\"",
    generating: Reading.self,
    options: GenerationOptions(sampling: .greedy)
  )
  var out: [String: Int] = [:]
  for m in reply.content.flavors {
    let key = String(describing: m.family)
    out[key] = max(out[key] ?? 0, min(max(m.intensity, 1), 3))
  }
  return out
}
#endif
