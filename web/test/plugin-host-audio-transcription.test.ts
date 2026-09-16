import { describe, expect, test } from "bun:test";

import { parseAudioTranscriptionResponse } from "@/services/plugin-host";

describe("FrameScript system-channel transcription", () => {
    test("normalizes standard OpenAI transcription segments to milliseconds", () => {
        expect(parseAudioTranscriptionResponse({
            text: "你好，影策。",
            segments: [{ start: 1.25, end: 2.5, text: "你好，影策。" }],
        })).toEqual({ text: "你好，影策。", segments: [{ startMs: 1250, endMs: 2500, text: "你好，影策。" }] });
    });

    test("rejects a successful HTTP payload without transcript text", () => {
        expect(() => parseAudioTranscriptionResponse({ segments: [] })).toThrow("系统渠道未返回有效的转写文本");
    });
});
