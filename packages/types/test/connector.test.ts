import { describe, expect, it } from "vitest";

import { isConnectorEvent, isConnectorEventMessage } from "../src/connector.js";

describe("isConnectorEventMessage", () => {
  it("accepts text message", () => {
    expect(isConnectorEventMessage({ type: "text", text: "hello" })).toBe(true);
  });

  it("accepts image message", () => {
    expect(isConnectorEventMessage({ type: "image", url: "https://example.com/img.png" })).toBe(true);
  });

  it("accepts file message", () => {
    expect(isConnectorEventMessage({ type: "file", url: "https://example.com/doc.pdf", name: "doc.pdf" })).toBe(true);
  });

  it("rejects text message without text field", () => {
    expect(isConnectorEventMessage({ type: "text" })).toBe(false);
  });

  it("rejects image message without url field", () => {
    expect(isConnectorEventMessage({ type: "image" })).toBe(false);
  });

  it("rejects file message without name field", () => {
    expect(isConnectorEventMessage({ type: "file", url: "https://example.com/doc.pdf" })).toBe(false);
  });

  it("rejects unknown type", () => {
    expect(isConnectorEventMessage({ type: "video", url: "https://example.com/v.mp4" })).toBe(false);
  });

  it("rejects null", () => {
    expect(isConnectorEventMessage(null)).toBe(false);
  });

  it("rejects string", () => {
    expect(isConnectorEventMessage("text")).toBe(false);
  });

  it("rejects array", () => {
    expect(isConnectorEventMessage([])).toBe(false);
  });
});

describe("isConnectorEvent", () => {
  const validEvent = {
    name: "telegram_message",
    message: { type: "text", text: "hello" },
    properties: { chat_id: "123" },
    instanceKey: "telegram:123",
  };

  it("accepts valid event", () => {
    expect(isConnectorEvent(validEvent)).toBe(true);
  });

  it("rejects event without name", () => {
    expect(isConnectorEvent({ ...validEvent, name: undefined })).toBe(false);
  });

  it("rejects event with invalid message", () => {
    expect(isConnectorEvent({ ...validEvent, message: { type: "unknown" } })).toBe(false);
  });

  it("rejects event without properties", () => {
    expect(isConnectorEvent({ ...validEvent, properties: "bad" })).toBe(false);
  });

  it("rejects event without instanceKey", () => {
    expect(isConnectorEvent({ ...validEvent, instanceKey: 123 })).toBe(false);
  });

  it("rejects null", () => {
    expect(isConnectorEvent(null)).toBe(false);
  });
});
