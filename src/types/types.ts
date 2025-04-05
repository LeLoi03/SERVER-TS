//Giữ nguyên, có thể import type từ thư viện của google nếu cần
import type {
    Content,
    FunctionCall,
    GenerationConfig,
    GenerativeContentBlob,
    Part,
    Tool,
  } from "@google/generative-ai";
  
  /**
   * the config to initiate the session
   */
  export type LiveConfig = {
    model: string;
    systemInstruction?: { parts: Part[] };
    generationConfig?: Partial<LiveGenerationConfig>;
    tools?: Array<Tool | { googleSearch: {} } | { codeExecution: {} }>;
  };
  
  export type LiveGenerationConfig = GenerationConfig & {
  //   responseModalities: "text" | "audio" | "image"; // Cái này có thể không cần nữa.
    speechConfig?: {
      voiceConfig?: {
        prebuiltVoiceConfig?: {
          voiceName: "Puck" | "Charon" | "Kore" | "Fenrir" | "Aoede" | string;
        };
      };
    };
  };
  
  export type LiveOutgoingMessage =
    | SetupMessage
    | ClientContentMessage
    | RealtimeInputMessage
    | ToolResponseMessage
    | ServerContentMessage // Backend sẽ gửi cái này
    | SetupCompleteMessage
    | AudioDataMessage  // Thêm message type cho audio data
    | ToolCallMessage;
  
  
  export type SetupMessage = {
    setup: LiveConfig;
  };
  
  export type ClientContentMessage = {
    clientContent: {
      turns: Content[];
      turnComplete: boolean;
    };
  };
  
  export type RealtimeInputMessage = {
    realtimeInput: {
      mediaChunks: GenerativeContentBlob[];
    };
  };
  
  export type ToolResponseMessage = {
    toolResponse: {
      functionResponses: LiveFunctionResponse[];
    };
  };
  
  export type ToolResponse = ToolResponseMessage["toolResponse"];
  
  export type LiveFunctionResponse = {
    response: object;
    id: string;
  };
  
  export type SetupCompleteMessage = { setupComplete: {} };
  
  export type ServerContentMessage = {
    serverContent: ServerContent;
  };
  
  export type ServerContent = ModelTurn | TurnComplete | Interrupted;
  
  export type ModelTurn = {
    modelTurn: {
      parts: Part[];
    };
  };
  
  export type TurnComplete = { turnComplete: boolean };
  
  export type Interrupted = { interrupted: true };
  
  export type ToolCallCancellationMessage = {
    toolCallCancellation: {
      ids: string[];
    };
  };
  
  export type ToolCallCancellation =
    ToolCallCancellationMessage["toolCallCancellation"];
  
  export type ToolCallMessage = {
    toolCall: ToolCall;
  };
  
  export type LiveFunctionCall = FunctionCall & {
    id: string;
  };
  
  /**
   * A `toolCall` message
   */
  export type ToolCall = {
    functionCalls: LiveFunctionCall[];
  };
  
  export type AudioDataMessage = {
    audioData: string; // base64 encoded audio
  }
  
  //Định nghĩa các type của message nhận về từ client
  export type LiveIncomingMessage =
   | SetupMessage
   | ClientContentMessage
   | RealtimeInputMessage
   | ToolResponseMessage
  
  // Type-Guards
  
  const prop = (a: any, prop: string, kind: string = "object") =>
    typeof a === "object" && typeof a[prop] === "object";
  
  // outgoing messages
  export const isSetupMessage = (a: unknown): a is SetupMessage =>
    prop(a, "setup");
  
  export const isClientContentMessage = (a: unknown): a is ClientContentMessage =>
    prop(a, "clientContent");
  
  export const isRealtimeInputMessage = (a: unknown): a is RealtimeInputMessage =>
    prop(a, "realtimeInput");
  
  export const isToolResponseMessage = (a: unknown): a is ToolResponseMessage =>
    prop(a, "toolResponse");
  
  //incoming messages
  export const isSetupCompleteMessage = (a: unknown): a is SetupCompleteMessage =>
    prop(a, "setupComplete");
  
  export const isServerContentMessage = (a: any): a is ServerContentMessage =>
    prop(a, "serverContent");
  
  export const isToolCallMessage = (a: any): a is ToolCallMessage =>
    prop(a, "toolCall");
  
  export const isToolCallCancellationMessage = (
    a: unknown,
  ): a is ToolCallCancellationMessage =>
    prop(a, "toolCallCancellation") &&
    isToolCallCancellation((a as any).toolCallCancellation);
  
  export const isModelTurn = (a: any): a is ModelTurn =>
    typeof (a as ModelTurn).modelTurn === "object";
  
  export const isTurnComplete = (a: any): a is TurnComplete =>
    typeof (a as TurnComplete).turnComplete === "boolean";
  
  export const isInterrupted = (a: any): a is Interrupted =>
    (a as Interrupted).interrupted;
  
  
  export function isToolCall(value: unknown): value is ToolCall {
    if (!value || typeof value !== "object") return false;
  
    const candidate = value as Record<string, unknown>;
  
    return (
      Array.isArray(candidate.functionCalls) &&
      candidate.functionCalls.every((call) => isLiveFunctionCall(call))
    );
  }
  
  export function isToolResponse(value: unknown): value is ToolResponse {
    if (!value || typeof value !== "object") return false;
  
    const candidate = value as Record<string, unknown>;
  
    return (
      Array.isArray(candidate.functionResponses) &&
      candidate.functionResponses.every((resp) => isLiveFunctionResponse(resp))
    );
  }
  
  export function isLiveFunctionCall(value: unknown): value is LiveFunctionCall {
    if (!value || typeof value !== "object") return false;
  
    const candidate = value as Record<string, unknown>;
  
    return (
      typeof candidate.name === "string" &&
      typeof candidate.id === "string" &&
      typeof candidate.args === "object" &&
      candidate.args !== null
    );
  }
  
  export function isLiveFunctionResponse(
    value: unknown,
  ): value is LiveFunctionResponse {
    if (!value || typeof value !== "object") return false;
  
    const candidate = value as Record<string, unknown>;
  
    return (
      typeof candidate.response === "object" && typeof candidate.id === "string"
    );
  }
  
  export const isToolCallCancellation = (
    a: unknown,
  ): a is ToolCallCancellationMessage["toolCallCancellation"] =>
    typeof a === "object" && Array.isArray((a as any).ids);
  
  export const isAudioDataMessage = (a:unknown): a is AudioDataMessage =>
      prop(a, "audioData", "string")



  export type ConferenceDateInput = {
      fromDate: Date | null;
      toDate: Date | null;
      type: string;
      name: string;
      organizedId: string;
      isAvailable: boolean;
  };