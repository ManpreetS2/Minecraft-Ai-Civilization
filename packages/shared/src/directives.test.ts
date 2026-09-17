import { describe, expect, it } from "vitest";
import { DirectiveBoard } from "./directive-board.js";
import { parseHumanDirective, resolveDirectiveTargets } from "./directives.js";

const citizens = [
  { id: "citizen_atlas", name: "Atlas" },
  { id: "citizen_maya", name: "Maya" },
  { id: "citizen_theo", name: "Theo" },
  { id: "citizen_ava", name: "Ava" },
  { id: "citizen_kai", name: "Kai" },
];

describe("natural language directives", () => {
  it("parses a valid individual instruction", () => {
    const parsed = parseHumanDirective("Atlas get some wood", citizens);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.intent).toBe("gather_wood");
    expect(parsed.targetNames).toEqual(["Atlas"]);
  });

  it("rejects an unknown instruction", () => {
    const parsed = parseHumanDirective("Atlas do a backflip", citizens);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/don't recognize/i);
  });

  it("rejects unsafe control text", () => {
    expect(parseHumanDirective("Atlas eval(process.exit())", citizens)).toMatchObject({ ok: false });
    expect(parseHumanDirective("Maya child_process spawn", citizens)).toMatchObject({ ok: false });
  });

  it("parses group and named commands", () => {
    const everyone = parseHumanDirective("Everyone return to the village", citizens);
    expect(everyone.ok).toBe(true);
    if (everyone.ok) expect(everyone.everyone).toBe(true);

    const theo = parseHumanDirective("Theo help finish the shelter", citizens);
    expect(theo.ok).toBe(true);
    if (theo.ok) expect(theo.intent).toBe("contribute_to_project");

    const food = parseHumanDirective("Maya find food", citizens);
    expect(food.ok).toBe(true);
    if (food.ok) expect(food.intent).toBe("gather_food");

    const tools = parseHumanDirective("Focus on getting stone tools", citizens);
    expect(tools.ok).toBe(true);
    if (tools.ok) expect(tools.intent).toBe("craft_tools");

    const door = parseHumanDirective("Kai craft an oak door", citizens);
    expect(door.ok).toBe(true);
    if (door.ok) {
      expect(door.intent).toBe("obtain_item");
      expect(door.item).toBe("oak_door");
      expect(door.targetNames).toEqual(["Kai"]);
    }

    const pick = parseHumanDirective("Kai obtain stone pickaxe", citizens);
    expect(pick.ok).toBe(true);
    if (pick.ok) {
      expect(pick.intent).toBe("obtain_item");
      expect(pick.item).toBe("stone_pickaxe");
    }

    const give = parseHumanDirective("Give Atlas some food", citizens);
    expect(give.ok).toBe(true);
    if (give.ok) expect(give.intent).toBe("transfer_item");
  });

  it("resolves UI target, named target, and invalid target", () => {
    const wood = parseHumanDirective("get some wood", citizens);
    expect(wood.ok).toBe(true);
    if (!wood.ok) return;
    const atlas = resolveDirectiveTargets(wood, citizens, ["citizen_atlas"]);
    expect(atlas).toEqual({ ok: true, targetIds: ["citizen_atlas"] });
    const missing = resolveDirectiveTargets(wood, citizens, ["citizen_nobody"]);
    expect(missing.ok).toBe(false);
    const unnamed = resolveDirectiveTargets(wood, citizens, []);
    expect(unnamed.ok).toBe(false);
  });
});

describe("directive board", () => {
  it("creates suggestion, directive, and admin modes without faking completion", () => {
    const board = new DirectiveBoard(true);
    for (const mode of ["SUGGESTION", "DIRECTIVE", "ADMIN_OVERRIDE"] as const) {
      const created = board.create({
        rawText: "Atlas get some wood",
        mode,
        selectedIds: ["citizen_atlas"],
        citizens,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.directive.mode).toBe(mode);
      expect(created.directive.status).toBe("ACTIVE");
      expect(created.directive.completedAt).toBeUndefined();
    }
  });

  it("tracks group outcomes separately", () => {
    const board = new DirectiveBoard(true);
    const created = board.create({
      rawText: "Everyone return to the village",
      mode: "DIRECTIVE",
      selectedIds: [],
      citizens,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.directive.targetIds).toHaveLength(5);
    board.recordOutcome(created.directive.id, "citizen_atlas", "COMPLETED");
    board.recordOutcome(created.directive.id, "citizen_maya", "COMPLETED");
    board.recordOutcome(created.directive.id, "citizen_theo", "ACTIVE");
    board.recordOutcome(created.directive.id, "citizen_ava", "FAILED", "couldn't find a path home");
    expect(board.get(created.directive.id)?.status).toBe("ACTIVE");
    board.recordOutcome(created.directive.id, "citizen_theo", "COMPLETED");
    board.recordOutcome(created.directive.id, "citizen_kai", "COMPLETED");
    expect(board.get(created.directive.id)?.status).toBe("FAILED");
  });

  it("cancels a directive", () => {
    const board = new DirectiveBoard(true);
    const created = board.create({
      rawText: "Maya find food",
      mode: "DIRECTIVE",
      selectedIds: ["citizen_maya"],
      citizens,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const cancelled = board.cancel(created.directive.id);
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.directive.status).toBe("CANCELLED");
  });

  it("rejects disabled directives and invalid targets", () => {
    const disabled = new DirectiveBoard(false);
    expect(
      disabled.create({ rawText: "Atlas get some wood", mode: "DIRECTIVE", selectedIds: ["citizen_atlas"], citizens }).ok,
    ).toBe(false);
    const board = new DirectiveBoard(true);
    const bad = board.create({
      rawText: "get some wood",
      mode: "DIRECTIVE",
      selectedIds: ["citizen_nobody"],
      citizens,
    });
    expect(bad.ok).toBe(false);
    const unknownMode = board.create({
      rawText: "Atlas get some wood",
      mode: "CHEAT",
      selectedIds: ["citizen_atlas"],
      citizens,
    });
    expect(unknownMode.ok).toBe(false);
  });

  it("only maps to the approved intent list", () => {
    const board = new DirectiveBoard(true);
    const created = board.create({
      rawText: "Put the wood in the chest",
      mode: "DIRECTIVE",
      selectedIds: ["citizen_atlas"],
      citizens,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.directive.parsedIntent).toBe("deposit_items");
  });
});
