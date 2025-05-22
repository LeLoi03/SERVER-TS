// src/chatbot/interface/functionHandler.interface.ts
import { FunctionHandlerInput, FunctionHandlerOutput } from '../shared/types';

/**
 * @interface IFunctionHandler
 * Interface that all concrete function handler classes must implement.
 * This interface defines the contract for executing specific functions (tools)
 * as requested by the Large Language Model (LLM).
 * Each function handler is responsible for performing a specific task,
 * such as calling an external API, performing data manipulation, or interacting with other services.
 */
export interface IFunctionHandler {
    /**
     * Executes the logic associated with a specific function (tool) requested by the LLM.
     * This method receives a context object containing all necessary information to perform the task,
     * such as arguments from the LLM, handler IDs, socket information, and callbacks for status updates.
     *
     * Implementations should perform their designated task, handle any errors,
     * and return a `FunctionHandlerOutput` object that includes the content
     * to be sent back to the LLM (or user) and any optional frontend actions.
     *
     * @param {FunctionHandlerInput} context - An object containing all necessary input for the function handler.
     *   - `args`: Arguments extracted from the LLM's function call.
     *   - `handlerId`: Unique identifier for the current handler's process.
     *   - `socketId`: ID of the client socket.
     *   - `onStatusUpdate`: Callback function to send status updates (including `ThoughtStep`s).
     *   - `agentId`: Identifier of the agent (Host or Sub-Agent) that invoked this function.
     *   - `context`: Additional context data passed through the system.
     *
     * @returns {Promise<FunctionHandlerOutput>} A promise that resolves to an object containing:
     *   - `modelResponseContent`: The content to be sent back to the LLM or user.
     *   - `frontendAction`: Optional action for the frontend (e.g., display a UI component).
     *   - `thoughts`: An array of `ThoughtStep` objects detailing the execution flow and internal thoughts.
     */
    execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput>;
}