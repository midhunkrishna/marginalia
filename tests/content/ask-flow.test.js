import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// GA.askFlow — the shared transport policy: Gemini web-token acquisition and
// the invalidate-retry-once on an expired page token (AUTH), with stop/abort
// forwarded to whichever service handle is currently live.

let GA;
beforeEach(() => {
  GA = loadGA(["src/core/sites.js", "src/content/ask-flow.js"]);
  GA.provider = "gemini";
  GA.settings = {};
  GA.tokenProvider = {
    get: vi.fn(async () => ({ at: "tok" })),
    invalidate: vi.fn(),
  };
  GA.askService = { ask: vi.fn() };
});

const okHandle = (text) => ({ result: Promise.resolve(text), stop: vi.fn(), abort: vi.fn() });

describe("GA.askFlow.ask", () => {
  it("gemini web path fetches tokens and passes them through", async () => {
    GA.askService.ask.mockReturnValue(okHandle("answer"));
    const onChunk = () => {};
    const h = GA.askFlow.ask("prompt", onChunk);
    await expect(h.result).resolves.toBe("answer");
    expect(GA.tokenProvider.get).toHaveBeenCalledTimes(1);
    expect(GA.askService.ask).toHaveBeenCalledWith(
      { provider: "gemini", prompt: "prompt", tokens: { at: "tok" } },
      onChunk,
    );
  });

  it("skips tokens on other providers and when a Gemini API key is set", async () => {
    GA.provider = "chatgpt";
    GA.askService.ask.mockReturnValue(okHandle(""));
    await GA.askFlow.ask("p", () => {}).result;
    GA.provider = "gemini";
    GA.settings = { geminiApiKey: "k" };
    GA.askService.ask.mockReturnValue(okHandle(""));
    await GA.askFlow.ask("p", () => {}).result;
    expect(GA.tokenProvider.get).not.toHaveBeenCalled();
    expect(GA.askService.ask.mock.calls.every(([req]) => req.tokens === undefined)).toBe(true);
  });

  it("AUTH failure invalidates the token cache and retries exactly once", async () => {
    const err = Object.assign(new Error("expired"), { code: "AUTH" });
    GA.askService.ask
      .mockReturnValueOnce({ result: Promise.reject(err), stop: vi.fn(), abort: vi.fn() })
      .mockReturnValueOnce(okHandle("second try"));
    await expect(GA.askFlow.ask("p", () => {}).result).resolves.toBe("second try");
    expect(GA.tokenProvider.invalidate).toHaveBeenCalledTimes(1);
    expect(GA.tokenProvider.get).toHaveBeenCalledTimes(2);
  });

  it("a second AUTH failure propagates (no retry loop)", async () => {
    const err = Object.assign(new Error("expired"), { code: "AUTH" });
    GA.askService.ask.mockReturnValue({
      result: Promise.reject(err),
      stop: vi.fn(),
      abort: vi.fn(),
    });
    await expect(GA.askFlow.ask("p", () => {}).result).rejects.toBe(err);
    expect(GA.askService.ask).toHaveBeenCalledTimes(2);
  });

  it("non-AUTH errors propagate without retry", async () => {
    const err = new Error("boom");
    GA.askService.ask.mockReturnValue({
      result: Promise.reject(err),
      stop: vi.fn(),
      abort: vi.fn(),
    });
    await expect(GA.askFlow.ask("p", () => {}).result).rejects.toBe(err);
    expect(GA.askService.ask).toHaveBeenCalledTimes(1);
    expect(GA.tokenProvider.invalidate).not.toHaveBeenCalled();
  });

  it("stop/abort forward to the live handle — including the retry's handle", async () => {
    const err = Object.assign(new Error("expired"), { code: "AUTH" });
    const second = { result: new Promise(() => {}), stop: vi.fn(), abort: vi.fn() };
    GA.askService.ask
      .mockReturnValueOnce({ result: Promise.reject(err), stop: vi.fn(), abort: vi.fn() })
      .mockReturnValueOnce(second);
    const h = GA.askFlow.ask("p", () => {});
    await vi.waitFor(() => expect(GA.askService.ask).toHaveBeenCalledTimes(2));
    h.stop();
    expect(second.stop).toHaveBeenCalled();
  });

  it("a stop that races the token fetch applies as soon as the handle exists", async () => {
    let releaseTokens;
    GA.tokenProvider.get = vi.fn(() => new Promise((r) => (releaseTokens = () => r({ at: "t" }))));
    const handle = { result: new Promise(() => {}), stop: vi.fn(), abort: vi.fn() };
    GA.askService.ask.mockReturnValue(handle);
    const h = GA.askFlow.ask("p", () => {});
    h.stop(); // service handle doesn't exist yet
    releaseTokens();
    await vi.waitFor(() => expect(GA.askService.ask).toHaveBeenCalled());
    expect(handle.stop).toHaveBeenCalled();
  });

  it("an aborted flow never AUTH-retries", async () => {
    const err = Object.assign(new Error("expired"), { code: "AUTH" });
    let rejectFirst;
    GA.askService.ask.mockReturnValueOnce({
      result: new Promise((_, rej) => (rejectFirst = rej)),
      stop: vi.fn(),
      abort: vi.fn(),
    });
    const h = GA.askFlow.ask("p", () => {});
    await vi.waitFor(() => expect(GA.askService.ask).toHaveBeenCalledTimes(1));
    h.abort();
    rejectFirst(err);
    await expect(h.result).rejects.toBe(err);
    expect(GA.askService.ask).toHaveBeenCalledTimes(1);
  });
});

// ---- issue #8: provider override ----------------------------------------
describe("GA.askFlow.ask — provider override", () => {
  it("posts the override as `provider` and skips Gemini web tokens off the web path", async () => {
    GA.provider = "claude";
    GA.settings = { geminiApiKey: "k" };
    GA.askService.ask.mockReturnValue(okHandle("via gemini"));
    const onChunk = () => {};
    await expect(GA.askFlow.ask("p", onChunk, { provider: "gemini" }).result).resolves.toBe(
      "via gemini",
    );
    expect(GA.tokenProvider.get).not.toHaveBeenCalled();
    expect(GA.askService.ask).toHaveBeenCalledWith(
      { provider: "gemini", prompt: "p", tokens: undefined },
      onChunk,
    );
  });

  it("on gemini.google.com, overriding to another provider leaves the web-token path alone", async () => {
    GA.settings = { openaiApiKey: "k" };
    GA.askService.ask.mockReturnValue(okHandle(""));
    await GA.askFlow.ask("p", () => {}, { provider: "chatgpt" }).result;
    expect(GA.tokenProvider.get).not.toHaveBeenCalled();
    expect(GA.askService.ask.mock.calls[0][0].provider).toBe("chatgpt");
  });

  it("an override without an API key rejects up front, pointing at Options", async () => {
    GA.provider = "claude";
    GA.settings = {};
    await expect(GA.askFlow.ask("p", () => {}, { provider: "gemini" }).result).rejects.toThrow(
      /Gemini API key in Options/,
    );
    expect(GA.askService.ask).not.toHaveBeenCalled();
  });

  it("an override equal to the site provider behaves exactly like no override", async () => {
    GA.askService.ask.mockReturnValue(okHandle(""));
    await GA.askFlow.ask("p", () => {}, { provider: "gemini" }).result;
    expect(GA.tokenProvider.get).toHaveBeenCalledTimes(1);
  });
});
