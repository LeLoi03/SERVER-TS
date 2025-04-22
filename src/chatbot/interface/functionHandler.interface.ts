// src/chatbot/interface/functionHandler.interface.ts
import { FunctionHandlerInput, FunctionHandlerOutput } from '../shared/types';

/**
 * Interface that all specific function handlers must implement.
 */
export interface IFunctionHandler {
    execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput>;
}