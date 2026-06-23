import { z } from "zod";

const LanguageEnum = z.enum(["ja-JP", "en-US"]);

export const startSchema = z.object({
  type: z.literal("start"),
  sourceLanguage: LanguageEnum,
  targetLanguage: LanguageEnum,
  enableTts: z.boolean(),
  enableInterimTranslation: z.boolean().optional().default(false),
  chunkMs: z.number().int().positive(),
  silenceMs: z.number().int().positive(),
  maxChars: z.number().int().positive(),
  maxSeconds: z.number().int().positive(),
});

export const audioClientSchema = z.object({
  type: z.literal("audio"),
  data: z.string().min(1),
});

export const commitSchema = z.object({ type: z.literal("commit") });

export const stopSchema = z.object({ type: z.literal("stop") });

/**
 * client → server 受信メッセージのスキーマ。
 * start の sourceLanguage === targetLanguage の検証は discriminatedUnion の外で行う。
 */
const clientMessageBaseSchema = z.discriminatedUnion("type", [
  startSchema,
  audioClientSchema,
  commitSchema,
  stopSchema,
]);

export const clientMessageSchema = clientMessageBaseSchema.transform(
  (msg, ctx) => {
    if (
      msg.type === "start" &&
      msg.sourceLanguage === msg.targetLanguage
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sourceLanguage and targetLanguage must differ",
        path: ["targetLanguage"],
      });
      return z.NEVER;
    }
    return msg;
  }
);

export type StartMessage = z.infer<typeof startSchema>;
export type AudioClientMessage = z.infer<typeof audioClientSchema>;
export type CommitMessage = z.infer<typeof commitSchema>;
export type StopMessage = z.infer<typeof stopSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;
