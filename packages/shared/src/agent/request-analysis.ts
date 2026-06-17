import { z } from "zod";

// 欠缺信息由 Request Agent 提出，用 importance 表示它对降低目标不确定性的价值。
export const MissingInformationSchema = z.object({
  index: z.number().int().positive(),
  description: z.string().min(1),
  importance: z.number().min(0).max(1),
});

// business_model 是后续产品/业务 Agent 真正要继续处理的请求集合。
export const BusinessModelItemSchema = z.object({
  index: z.number().int().positive(),
  user_goal: z.string().min(1),
  goal_constraints: z.array(z.string().min(1)),
  missing_information: z.array(MissingInformationSchema),
  covered_user_input_indexes: z.array(z.number().int().positive()),
});

// 顶层结果把用户独立语句拆成业务请求、Agent 问答和产品无关闲聊三类。
export const RequestAnalysisSchema = z.object({
  business_model: z.array(BusinessModelItemSchema),
  questions: z.array(z.number().int().positive()),
  chitchat: z.array(z.number().int().positive()),
});

export type MissingInformation = z.infer<typeof MissingInformationSchema>;
export type BusinessModelItem = z.infer<typeof BusinessModelItemSchema>;
export type RequestAnalysis = z.infer<typeof RequestAnalysisSchema>;
