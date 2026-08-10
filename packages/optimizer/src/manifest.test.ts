import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPTIMIZER_TRAINING_SETTINGS,
  OFFICIAL_OPTIMIZER_TRAINING_CONFIG,
  OPTIMIZER_TRAINING_MANIFEST,
  resolveOptimizerTrainingConfig,
  validateOptimizerTrainingConfig,
  validateOptimizerTrainingSettings,
} from "./index.js";

describe("optimizer training capability manifest", () => {
  it("offers only the reviewed safe training choices", () => {
    expect(OPTIMIZER_TRAINING_MANIFEST.controls).toEqual([
      expect.objectContaining({
        key: "numEpochs",
        choices: [3, 5, 7, 10],
        defaultValue: 5,
      }),
      expect.objectContaining({
        key: "batchSize",
        choices: [128, 256, 512, 1024],
        defaultValue: 512,
      }),
      expect.objectContaining({
        key: "maxSeqLen",
        choices: [64, 128, 256, 512],
        defaultValue: 256,
      }),
    ]);
    expect(DEFAULT_OPTIMIZER_TRAINING_SETTINGS).toEqual({
      numEpochs: 5,
      batchSize: 512,
      maxSeqLen: 256,
    });
  });

  it("pins official non-editable values and merges only editable choices", () => {
    expect(OPTIMIZER_TRAINING_MANIFEST.readOnly).toEqual({
      seed: 2023,
      learningRate: 0.04,
      gamma: 1,
    });
    expect(
      resolveOptimizerTrainingConfig({
        numEpochs: 7,
        batchSize: 256,
        maxSeqLen: 128,
      }),
    ).toEqual({
      numEpochs: 7,
      batchSize: 256,
      seed: 2023,
      maxSeqLen: 128,
      learningRate: 0.04,
      gamma: 1,
    });
    expect(() =>
      validateOptimizerTrainingConfig({
        ...OFFICIAL_OPTIMIZER_TRAINING_CONFIG,
        seed: 2024,
      }),
    ).toThrow("OPTIMIZER_TRAINING_CONFIG_INVALID");
  });

  it("rejects arbitrary and unknown editable values", () => {
    expect(() =>
      validateOptimizerTrainingSettings({
        numEpochs: 100,
        batchSize: 512,
        maxSeqLen: 256,
      }),
    ).toThrow("OPTIMIZER_TRAINING_SETTINGS_INVALID");
    expect(() =>
      validateOptimizerTrainingSettings({
        numEpochs: 5,
        batchSize: 512,
        maxSeqLen: 256,
        seed: 1,
      }),
    ).toThrow("OPTIMIZER_TRAINING_SETTINGS_INVALID");
  });

  it("classifies every upstream capability without exposing dangerous knobs", () => {
    expect(OPTIMIZER_TRAINING_MANIFEST.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "weights", classification: "managed" }),
        expect.objectContaining({ key: "enableShortTerm", classification: "derived" }),
        expect.objectContaining({ key: "numRelearningSteps", classification: "derived" }),
        expect.objectContaining({ key: "progress", classification: "internal" }),
        expect.objectContaining({ key: "timeout", classification: "internal" }),
        expect.objectContaining({ key: "convertCsvToFsrsItems", classification: "tool" }),
        expect.objectContaining({ key: "wasiLoader", classification: "internal" }),
        expect.objectContaining({ key: "bindingConstructors", classification: "internal" }),
        expect.objectContaining({ key: "evaluationHelpers", classification: "tool" }),
        expect.objectContaining({ key: "sm2Migration", classification: "tool" }),
      ]),
    );
    expect(
      OPTIMIZER_TRAINING_MANIFEST.capabilities.some(
        (capability) => (capability.classification as string) === "editable",
      ),
    ).toBe(false);
  });
});
