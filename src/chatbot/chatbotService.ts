// // import fs from 'fs/promises';
// // import path from 'path';
// // import { fileURLToPath } from 'url';
// // import { GoogleGenerativeAI } from "@google/generative-ai";
// // import dotenv from 'dotenv';
// // dotenv.config();
// // import { logToFile } from './logger';
// // import { filterConferences, filterJournals, determineUserIntent } from './filter-information'


// // import { ChatResponse, HistoryItem, ChatHistoryType } from './chatbot-types'; // Import


// // // --- Configuration Loading ---

// // interface ModelConfig {
// //     temperature: number;
// //     topP: number;
// //     topK: number;
// //     maxOutputTokens: number;
// //     responseMimeType: string | undefined;
// // }

// // function loadModelConfig(prefix: string): ModelConfig {
// //     return {
// //         temperature: parseFloat(process.env[`${prefix}_TEMPERATURE`] || "0"), // Provide default value to avoid NaN
// //         topP: parseFloat(process.env[`${prefix}_TOP_P`] || "0"), // Provide default value to avoid NaN
// //         topK: parseInt(process.env[`${prefix}_TOP_K`] || "0", 10), // Provide default value to avoid NaN
// //         maxOutputTokens: parseInt(process.env[`${prefix}_MAX_OUTPUT_TOKENS`] || "0", 10), // Provide default value to avoid NaN
// //         responseMimeType: process.env[`${prefix}_RESPONSE_MIME_TYPE`],
// //     };
// // }

// // const chatbotGenerationConfig: ModelConfig = loadModelConfig("CHATBOT");
// // const visualizeGenerationConfig: ModelConfig = loadModelConfig("VISUALIZE");
// // const CHATBOT_MODEL_NAME = process.env.CHATBOT_MODEL_NAME || "gemini-1.5-pro-latest"; // Provide default value
// // const VISUALIZE_MODEL_NAME = process.env.VISUALIZE_MODEL_NAME || "gemini-1.5-pro-latest"; // Provide default value
// // const API_KEY = process.env.GEMINI_API_KEY;

// // if (!API_KEY) {
// //     throw new Error("GEMINI_API_KEY is not set in the environment variables.");
// // }

// // const genAI = new GoogleGenerativeAI(API_KEY);

// // // --- Configuration (Ideally in .env or a config file) ---

// // interface SystemInstructions {
// //     Conference: string;
// //     Journal: string;
// //     Website: string;
// // }

// // const SYSTEM_INSTRUCTIONS: SystemInstructions = {
// //     Conference: `
// // **Your Role:** ${process.env.CONFERENCE_ROLE}
// // **Task:** ${process.env.CONFERENCE_TASK}
// // **Response Requirements:** ${process.env.CONFERENCE_RESPONSE_REQUIREMENTS}
// // **Conversational Flow and Friendliness:** ${process.env.CONFERENCE_CONVERSATIONAL_FLOW}
// // **Important Considerations:** ${process.env.CONFERENCE_IMPORTANT_CONSIDERATIONS}
// // `,
// //     Journal: `
// // **Your Role:** ${process.env.JOURNAL_ROLE} // You'll need to define these
// // **Task:** ${process.env.JOURNAL_TASK}
// // **Response Requirements:** ${process.env.JOURNAL_RESPONSE_REQUIREMENTS}
// // **Conversational Flow and Friendliness:** ${process.env.JOURNAL_CONVERSATIONAL_FLOW}
// // **Important Considerations:** ${process.env.JOURNAL_IMPORTANT_CONSIDERATIONS}
// // `,
// //     Website: `
// // **Your Role:** ${process.env.WEBSITE_ROLE}
// // **Task:** ${process.env.WEBSITE_TASK}
// // **Response Requirements:** ${process.env.WEBSITE_RESPONSE_REQUIREMENTS}
// // **Conversational Flow and Friendliness:** ${process.env.WEBSITE_CONVERSATIONAL_FLOW}
// // **Important Considerations:** ${process.env.WEBSITE_IMPORTANT_CONSIDERATIONS}
// // `,
// // };

// // function getSystemInstruction(intent: string): string {
// //     return SYSTEM_INSTRUCTIONS[intent as keyof SystemInstructions] || SYSTEM_INSTRUCTIONS.Website; // Default to Website if intent is unknown
// // }

// // // --- History Processing ---

// // interface ChatEntry {
// //     role: "user" | "model";
// //     parts: { text: string }[];
// //     type?: string; // Make 'type' property optional

// // }
// // /**
// //  * Extracts user questions from the history.
// //  */
// // function extractUserQuestions(history: ChatEntry[]): string[] {
// //     return history
// //         .filter(entry => entry.role === "user")
// //         .map((entry, index) => `User question ${index + 1}: ${entry.parts[0].text}`);
// // }

// // // --- Gemini Model Interaction ---
// // /**
// //  * Gets a generative model with system instructions.
// //  */
// // function getModelWithSystemInstruction(modelName: string, systemInstruction: string) {
// //     return genAI.getGenerativeModel({
// //         model: modelName,
// //         systemInstruction: systemInstruction,
// //     });
// // }

// // /**
// //  * Starts a chat session with the given history and generation config.
// //  * @param model The Gemini model.
// //  * @param history The chat history.
// //  * @param generationConfig The generation configuration.
// //  * @returns A promise that resolves to the chat session.
// //  */
// // async function startChatSession(model: any, history: ChatEntry[], generationConfig: ModelConfig) {
// //     return model.startChat({
// //         generationConfig: generationConfig,
// //         history: history,
// //     });
// // }

// // /**
// //  * Sends a message to the Gemini model and returns the response.
// //  */
// // async function getGeminiResponse(model: any, userInput: string, generationConfig: ModelConfig, history: ChatEntry[] = []): Promise<any> {

// //     //For multi-turn conversations
// //     const chat = await startChatSession(model, history, generationConfig)
// //     const result = await chat.sendMessage(userInput);

// //     logToFile("Sent message to Gemini.");
// //     return result.response;
// // }

// // // --- Chart Generation ---
// // // --- Chart Generation ---

// // interface ChartData {
// //     echartsConfig: any;
// //     sqlQuery: string;
// //     description: string;
// // }

// // interface ChartResponse extends GeminiResponseBase { //remove, no need after using type
// //     type: 'chart';
// //     echartsConfig: any;
// //     sqlQuery: string;
// //     description: string;
// //     thought?: string; // Add thought, consistent with shared type
// // }

// // interface ErrorResponse extends GeminiResponseBase {
// //     type: 'error';
// //     message: string;
// // }

// // interface TextResponse extends GeminiResponseBase {
// //     type: 'text';
// //     message: string;
// // }

// // interface GeminiResponseBase {
// //     type: 'chart' | 'error' | 'text';
// // }

// // // Make sure GeminiResponse uses the shared type
// // type GeminiResponse = ChatResponse;

// // async function generateChartResponse(model: any, visualizeGenerationConfig: ModelConfig, history: ChatEntry[]): Promise<GeminiResponse> {
// //     const systemInstruction = ``;

// //     // Chart history , keep role = user, type = chart
// //     const chartQuestionsHistory = history.filter(entry => (entry.role === 'user' && entry.type === 'chart'))
// //         .map((entry, index) => `User question ${index + 1}: ${entry.parts[0].text}`)
// //         .join("\n");

// //     logToFile(`runNonStreamChat: chartQuestionsHistory = ${JSON.stringify(chartQuestionsHistory)}`);


// //     const parts = [
// //         { text: `input: ${chartQuestionsHistory}` },
// //         { text: "output: " },
// //     ];

// //     const modelInstance = getModelWithSystemInstruction(model, systemInstruction);

// //     // Use generateContent for single-turn chart generation
// //     const result = await modelInstance.generateContent({
// //         contents: [{ role: "user", parts }],
// //         generationConfig: visualizeGenerationConfig,
// //     });

// //     logToFile("runNonStreamChat: Sent message to Gemini (chart).");

// //     const responseText = result.response.text();
// //     logToFile(`Raw response from model (chart): ${responseText}`);

// //     try {
// //         const parsedResponse = JSON.parse(responseText);
// //         logToFile(`Parsed response (chart): ${JSON.stringify(parsedResponse)}`);

// //         if (parsedResponse?.Echarts && parsedResponse?.PostgresSQL && parsedResponse?.Description) {
// //             const chartData: ChartData = {
// //                 echartsConfig: parsedResponse.Echarts,
// //                 sqlQuery: parsedResponse.PostgresSQL,
// //                 description: parsedResponse.Description
// //             };
// //             logToFile(`chartData = ${JSON.stringify(chartData)}`);
// //             return { type: 'chart', ...chartData };
// //         } else {
// //             logToFile("Incomplete chart data.");
// //             return { type: 'error', message: 'Failed to generate complete chart data.' };
// //         }
// //     } catch (parseError) {
// //         logToFile(`Error parsing JSON response: ${parseError}`);
// //         return { type: 'error', message: 'Failed to parse chart data from the model.' };
// //     }
// // }


// // async function generateTextResponse(model: any, userInput: string, chatbotGenerationConfig: ModelConfig, history: ChatEntry[], intent: string, data: string = ""): Promise<GeminiResponse> {

// //     const systemInstruction = getSystemInstruction(intent);


// //     const textQuestionsHistory: ChatEntry[] = history.filter(entry => (entry.role === 'user' || entry.role === 'model') && entry.type === 'text')
// //         .map(entry => ({
// //             role: entry.role,//keep role is user (for gemini format)
// //             parts: [{ text: entry.parts[0].text }]
// //         }));

// //     // Add context based on intent *before* the user input
// //     if (intent === 'Conference' || intent === 'Journal') {
// //         textQuestionsHistory.unshift({
// //             role: 'user',
// //             parts: [{ text: `**${intent} database:**\n\n${data}` }],
// //         });
// //     } else if (intent === 'Website') {
// //         textQuestionsHistory.unshift({
// //             role: 'user',
// //             parts: [{ text: `**${intent} description:**\n\n${process.env.WEBSITE_DESCRIPTION}` }],
// //         });
// //     }


// //     const modelInstance = getModelWithSystemInstruction(model, systemInstruction);
// //     const response = await getGeminiResponse(modelInstance, userInput, chatbotGenerationConfig, textQuestionsHistory);
// //     const responseText = response.text();
// //     logToFile(`Raw response from model (text): ${JSON.stringify(responseText)}`);
// //     return { type: 'text', message: responseText };
// // }

// // // --- Utility Functions ---
// // /**
// //  * Formats a single history entry for saving.
// //  */
// // function formatHistoryEntry(entry: ChatEntry): string {
// //     const role = entry.role === 'user' ? 'User' : 'Model';
// //     const partsText = entry.parts.map(part => {
// //         // Check for chart object structure, otherwise treat as plain text.
// //         return part.text && typeof part.text === 'object' && (part.text as any).echartsConfig && (part.text as any).sqlResult && (part.text as any).description
// //             ? JSON.stringify(part.text)
// //             : (part.text != null ? String(part.text) : '');
// //     }).join('\n');
// //     return `${role}:\n${partsText}\n`;
// // }

// // /**
// //  * Saves the chat history to a file.
// //  */
// // async function saveHistoryToFile(history: ChatEntry[], filePath: string): Promise<void> {
// //     try {
// //         const formattedHistory = history.map(formatHistoryEntry).join('\n---\n');
// //         await fs.writeFile(filePath, formattedHistory, 'utf-8');
// //         logToFile(`Chat history saved to file: ${filePath}`); // Use the shared logger and template literal
// //     } catch (error: any) { // Specify type of error
// //         logToFile(`Error saving chat history: ${error.message}`);     // Use the shared logger and template literal
// //     }
// // }

// // // --- Intent Handling Functions (Placeholders) ---
// // // --- Intent Handling Functions (Placeholders) ---

// // interface Criteria {
// //     [key: string]: any; // Adjust this to be more specific if possible
// // }

// // interface Conference {
// //     [key: string]: any; // Adjust this to be more specific based on your conference data structure
// // }

// // interface Journal {
// //     [key: string]: any; // Adjust this to be more specific based on your journal data structure
// // }

// // interface NavigationResponse {
// //     type: 'navigation';
// //     navigationType: 'internal' | 'external';
// //     path?: string;
// //     url?: string;
// //     message: string;
// // }

// // async function handleFindInformationConferenceIntent(criteria: Criteria): Promise<Conference[]> {
// //     logToFile("handleFindInformationConferenceIntent: Function started.");
// //     logToFile(`handleFindInformationConferenceIntent: criteria = ${JSON.stringify(criteria)}`);

// //     let conferences: Conference[] = [];
// //     //if has criteria -> filter
// //     if (Object.keys(criteria).length !== 0) {
// //         try {
// //             const conferenceResults = await filterConferences(criteria, '../evaluate.csv', './output.txt');
// //             conferences = JSON.parse(conferenceResults); // Parse string as JSON
// //         } catch (error) {
// //             console.error("Error parsing conference data:", error);
// //             // Handle the error appropriately, maybe return an empty array or throw an error
// //             return [];
// //         }
// //     }

// //     logToFile(`handleFindInformationConferenceIntent: conferences = ${JSON.stringify(conferences)}`);
// //     logToFile("handleFindInformationConferenceIntent: Function completed.");
// //     return conferences;
// // }

// // async function handleFindInformationJournalIntent(criteria: Criteria): Promise<Journal[]> {
// //     logToFile("handleFindInformationJournalIntent: Function started.");
// //     logToFile(`handleFindInformationJournalIntent: criteria = ${JSON.stringify(criteria)}`);

// //     let journals: Journal[] = [];
// //     //if has criteria -> filter
// //     if (Object.keys(criteria).length !== 0) {
// //         try {
// //             const journalResults = await filterJournals(criteria, '../scimagojr_2023.csv', './journal_output.txt');
// //             journals = JSON.parse(journalResults); // Parse string as JSON
// //         } catch (error) {
// //             console.error("Error parsing journal data:", error);
// //             // Handle the error appropriately, maybe return an empty array or throw an error
// //             return [];
// //         }
// //     }

// //     logToFile(`handleFindInformationJournalIntent: journals = ${JSON.stringify(journals)}`);
// //     logToFile("handleFindInformationJournalIntent: Function completed.");
// //     return journals;
// // }

// // async function handleDrawChartIntent(history: ChatEntry[]): Promise<GeminiResponse> {
// //     logToFile("handleDrawChartIntent: Function started.");
// //     // TODO: Implement chart generation logic here
// //     logToFile("handleDrawChartIntent: Function completed.");
// //     return await generateChartResponse(VISUALIZE_MODEL_NAME, visualizeGenerationConfig, history);
// // }

// // interface UserIntentRedirect {
// //     Value: string;
// //     Message: string;
// //     Type: 'Internal website' | 'External website';
// // }

// // interface UserIntent {
// //     Redirect?: UserIntentRedirect;
// //     Intent?: string[];
// //     About?: string;
// //     Description?: string;
// // }

// // async function handleWebsiteNavigationIntent(userIntent: UserIntent): Promise<NavigationResponse | ErrorResponse> {
// //     logToFile("handleWebsiteNavigationIntent: Function started.");

// //     // Crucial:  Check for BOTH Redirect and Value/Message properties
// //     if (userIntent?.Redirect?.Value && userIntent?.Redirect?.Message && userIntent?.Redirect?.Type) {
// //         if (userIntent.Redirect.Type === 'Internal website') {
// //             logToFile("handleWebsiteNavigationIntent: Internal website navigation");
// //             return {
// //                 type: 'navigation',
// //                 navigationType: 'internal',
// //                 path: userIntent.Redirect.Value,
// //                 message: userIntent.Redirect.Message, // Include message
// //             };
// //         } else if (userIntent.Redirect.Type === 'External website') {
// //             logToFile("handleWebsiteNavigationIntent: External website navigation");
// //             return {
// //                 type: 'navigation',
// //                 navigationType: 'external',
// //                 url: userIntent.Redirect.Value,
// //                 message: userIntent.Redirect.Message, // Include message
// //             };
// //         } else {
// //             // Handle invalid Redirect.Type
// //             logToFile("handleWebsiteNavigationIntent: Invalid Redirect.Type");
// //             return {
// //                 type: 'error',
// //                 message: "Invalid navigation type specified.",
// //             }
// //         }
// //     } else {
// //         // Handle missing Redirect or Value/Message properties
// //         logToFile("handleWebsiteNavigationIntent: Missing Redirect information.");
// //         return {
// //             type: 'error',
// //             message: "Incomplete navigation information.",
// //         };
// //     }
// // }

// // async function handleNoIntent(): Promise<string> {
// //     logToFile("handleNoIntent: Function started.");

// //     const greetings = [
// //         // Group 1: Greetings and introduction of core functionality
// //         { response: "Hi there! I'm a chatbot designed to help you find information about conferences, academic journals, and websites. What are you looking for today?" },
// //         { response: "Hello! Do you need to find information about a conference, a scientific journal, or a website?" },
// //         { response: "Welcome! I can assist you in finding information about conferences, journals, and websites.  What field are you interested in?" },
// //         { response: "Hi!  Looking for a conference, a journal, or a website? I can help!" },

// //         // Group 2:  More specific suggestions about the types of information you can search for
// //         { response: "Hello! Are you looking for upcoming conferences, reputable scientific journals, or the website of a particular research institution?" },
// //         { response: "Hi! You can ask me about conference dates, locations, journal impact factors, or contact information for a research website." },
// //         { response: "Welcome! Try asking me about: 'Upcoming AI conferences', 'Top medical journals', or 'Website of the Vietnamese Academy of Science and Technology'." },

// //         // Group 3:  Asking about a specific field/domain
// //         { response: "Hello! What field are you interested in for conferences, journals, or websites?  For example: computer science, medicine, economics, etc." },
// //         { response: "Hi! Are you looking for information in the fields of science, engineering, social sciences, or humanities?" },
// //         { response: "To best assist you, could you tell me the field you're interested in?" },

// //         // Group 4: Short and concise greetings and asking for needs
// //         { response: "Hello! What information are you looking for?" },
// //         { response: "Hi! How can I help you?" },
// //         { response: "Welcome! What are you searching for today?" },
// //     ];

// //     const randomIndex = Math.floor(Math.random() * greetings.length);
// //     const selectedGreeting = greetings[randomIndex];

// //     logToFile("handleNoIntent: Function completed.");
// //     return selectedGreeting.response;
// // }

// // async function handleInvalidIntent(criteria: Criteria): Promise<string> {
// //     logToFile("handleInvalidIntent: Function started.");
// //     // TODO: Handle invalid intents.  This might involve returning an error message or asking the user to rephrase.
// //     logToFile("handleInvalidIntent: Function completed.");
// //     return criteria.Description || "I'm sorry, I didn't understand your request."; // Example error message
// // }

// // // --- Main Chat Function ---

// // interface RunNonStreamChatResponse extends GeminiResponse {
// //     thought?: string;
// // }

// // /**
// //  * Processes user input and returns either a text or chart response.
// //  * @param userInput - The user's input.
// //  * @param history - The chat history.
// //  * @returns An object containing the response type and data.
// //  */
// // async function runNonStreamChat(userInput: string, history: ChatEntry[]): Promise<RunNonStreamChatResponse> {
// //     logToFile("runNonStreamChat: Function started.");
// //     logToFile(`runNonStreamChat: userInput = ${userInput}`);
// //     logToFile(`runNonStreamChat: history = ${JSON.stringify(history)}`);

// //     try {
// //         const questionList = extractUserQuestions(history).join("\n");
// //         logToFile(`runNonStreamChat: questionList = ${questionList}`);

// //         const userIntent: UserIntent = await determineUserIntent(questionList);
// //         logToFile(`runNonStreamChat: userIntent = ${JSON.stringify(userIntent)}`);
// //         const thought = userIntent?.Description || ""; // Extract thought (Description)

// //         // --- Intent-Based Routing ---
// //         if (userIntent?.Intent?.includes('Draw chart')) {
// //             logToFile("runNonStreamChat: Draw chart intent detected.");
// //             const chartResponse = await handleDrawChartIntent(history);
// //             return { ...chartResponse, thought: thought };

// //         } else if (userIntent?.Intent?.includes('Website navigation')) {
// //             logToFile("runNonStreamChat: Website navigation intent detected.");
// //             const navigationResponse = await handleWebsiteNavigationIntent(userIntent);
// //             return navigationResponse;

// //         } else if (userIntent?.Intent?.includes('Find information')) {
// //             logToFile("runNonStreamChat: Find information intent detected.");

// //             if (userIntent.About === 'Conference') {
// //                 const conferences = await handleFindInformationConferenceIntent(userIntent);
// //                 const textResponse = await generateTextResponse(CHATBOT_MODEL_NAME, userInput, chatbotGenerationConfig, history, 'Conference', JSON.stringify(conferences));
// //                 return { ...textResponse, thought: thought };

// //             } else if (userIntent.About === 'Journal') {
// //                 const journals = await handleFindInformationJournalIntent(userIntent);
// //                 const textResponse = await generateTextResponse(CHATBOT_MODEL_NAME, userInput, chatbotGenerationConfig, history, 'Journal', JSON.stringify(journals));
// //                 return { ...textResponse, thought: thought };

// //             } else if (userIntent.About === 'Website') {
// //                 const textResponse = await generateTextResponse(CHATBOT_MODEL_NAME, userInput, chatbotGenerationConfig, history, 'Website');
// //                 return { ...textResponse, thought: thought };

// //             } else {
// //                 logToFile("runNonStreamChat: Invalid About for Find information intent.");
// //                 return { type: 'error', thought: thought, message: "Invalid 'About' property for 'Find information' intent." };
// //             }

// //         } else if (userIntent?.Intent?.includes('No intent')) {
// //             logToFile("runNonStreamChat: No intent detected.");
// //             const noIntentResponse = await handleNoIntent();
// //             return { type: 'text', thought: thought, message: noIntentResponse };

// //         } else if (userIntent?.Intent?.includes('Invalid')) {
// //             logToFile("runNonStreamChat: Invalid intent detected.");
// //             return { type: 'text', thought: thought, message: await handleInvalidIntent(userIntent) };

// //         } else {
// //             logToFile("runNonStreamChat: No intent matched.");
// //             return { type: 'error', message: 'Could not determine the intent.' }; // Or handle more gracefully
// //         }

// //     } catch (error: any) { // Explicitly type 'error' as 'any'
// //         logToFile(`runNonStreamChat: Error: ${error}`);
// //         return { type: 'error', message: error.message || 'An unexpected error occurred.' };
// //     } finally {
// //         logToFile("runNonStreamChat: Function completed.");
// //     }
// // }

// // export { runNonStreamChat, saveHistoryToFile };


// import fs from 'fs/promises';
// import { GoogleGenerativeAI } from "@google/generative-ai";
// import dotenv from 'dotenv';
// dotenv.config();
// import { logToFile } from './logger';
// import { filterConferences, filterJournals, determineUserIntent } from './filter-information'
// import { ChatResponse, HistoryItem } from './shared/types'; // Import from shared types

// // --- Configuration Loading ---

// interface ModelConfig {
//     temperature: number;
//     topP: number;
//     topK: number;
//     maxOutputTokens: number;
//     responseMimeType: string | undefined;
// }

// function loadModelConfig(prefix: string): ModelConfig {
//     return {
//         temperature: parseFloat(process.env[`${prefix}_TEMPERATURE`] || "0.7"),  // More realistic defaults
//         topP: parseFloat(process.env[`${prefix}_TOP_P`] || "0.9"),
//         topK: parseInt(process.env[`${prefix}_TOP_K`] || "40", 10),
//         maxOutputTokens: parseInt(process.env[`${prefix}_MAX_OUTPUT_TOKENS`] || "2048", 10),
//         responseMimeType: process.env[`${prefix}_RESPONSE_MIME_TYPE`], // No default, can be undefined
//     };
// }

// const chatbotGenerationConfig: ModelConfig = loadModelConfig("CHATBOT");
// const visualizeGenerationConfig: ModelConfig = loadModelConfig("VISUALIZE");
// const CHATBOT_MODEL_NAME = process.env.CHATBOT_MODEL_NAME || "gemini-1.5-pro-latest";
// const VISUALIZE_MODEL_NAME = process.env.VISUALIZE_MODEL_NAME || "gemini-1.5-pro-latest";
// const API_KEY = process.env.GEMINI_API_KEY;

// if (!API_KEY) {
//     throw new Error("GEMINI_API_KEY is not set in the environment variables.");
// }

// const genAI = new GoogleGenerativeAI(API_KEY);

// // --- System Instructions (from .env) ---

// interface SystemInstructions {
//     Conference: string;
//     Journal: string;
//     Website: string;
// }

// const SYSTEM_INSTRUCTIONS: SystemInstructions = {
//     Conference: process.env.CONFERENCE_INSTRUCTIONS || "Default Conference Instructions",
//     Journal: process.env.JOURNAL_INSTRUCTIONS || "Default Journal Instructions",
//     Website: process.env.WEBSITE_INSTRUCTIONS || "Default Website Instructions",
// };

// function getSystemInstruction(intent: string): string {
//     return SYSTEM_INSTRUCTIONS[intent as keyof SystemInstructions] || SYSTEM_INSTRUCTIONS.Website;
// }

// // --- History Processing ---
// // No need for a separate ChatEntry interface, use HistoryItem from shared/types.ts

// /**
//  * Extracts user questions from the history.
//  */
// function extractUserQuestions(history: HistoryItem[]): string[] {
//     return history
//         .filter(entry => entry.role === "user")
//         .map((entry, index) => `User question ${index + 1}: ${entry.parts[0].text}`);
// }

// // --- Gemini Model Interaction ---

// function getModelWithSystemInstruction(modelName: string, systemInstruction: string) {
//     return genAI.getGenerativeModel({
//         model: modelName,
//         systemInstruction: systemInstruction,
//     });
// }

// async function startChatSession(model: any, history: HistoryItem[], generationConfig: ModelConfig) {
//     return model.startChat({
//         generationConfig: generationConfig,
//         history: history,
//     });
// }

// async function getGeminiResponse(model: any, userInput: string, generationConfig: ModelConfig, history: HistoryItem[] = []): Promise<any> {
//     const chat = await startChatSession(model, history, generationConfig);
//     const result = await chat.sendMessage(userInput);
//     logToFile("Sent message to Gemini.");
//     return result.response;
// }

// // --- Chart Generation ---

// interface ChartData {  // This is still useful, but not a ChatResponse itself
//     echartsConfig: any;
//     sqlQuery: string;
//     description: string;
// }

// async function generateChartResponse(model: any, visualizeGenerationConfig: ModelConfig, history: HistoryItem[]): Promise<ChatResponse> {
//     const systemInstruction = ""; // You might want a default chart instruction, or load from .env

//     const chartQuestionsHistory = history.filter(entry => (entry.role === 'user' && entry.type === 'chart'))
//         .map((entry, index) => `User question ${index + 1}: ${entry.parts[0].text}`)
//         .join("\n");

//     logToFile(`Chart questions history: ${JSON.stringify(chartQuestionsHistory)}`);

//     const parts = [
//         { text: `input: ${chartQuestionsHistory}` },
//         { text: "output: " },
//     ];

//     const modelInstance = getModelWithSystemInstruction(model, systemInstruction);

//     const result = await modelInstance.generateContent({
//         contents: [{ role: "user", parts }],
//         generationConfig: visualizeGenerationConfig,
//     });

//     logToFile("Sent message to Gemini (chart).");

//     const responseText = result.response.text();
//     logToFile(`Raw response from model (chart): ${responseText}`);

//     try {
//         const parsedResponse = JSON.parse(responseText);
//         logToFile(`Parsed response (chart): ${JSON.stringify(parsedResponse)}`);

//         if (parsedResponse?.Echarts && parsedResponse?.PostgresSQL && parsedResponse?.Description) {
//             const chartData: ChartData = {
//                 echartsConfig: parsedResponse.Echarts,
//                 sqlQuery: parsedResponse.PostgresSQL,
//                 description: parsedResponse.Description
//             };
//             logToFile(`Chart data: ${JSON.stringify(chartData)}`);
//             return { type: 'chart', ...chartData, thought: "Chart generation successful", sqlResult: [] }; // Add thought
//         } else {
//             logToFile("Incomplete chart data.");
//             return { type: 'error', message: 'Failed to generate complete chart data.', thought: "Incomplete data from Gemini" };
//         }
//     } catch (parseError) {
//         logToFile(`Error parsing JSON response: ${parseError}`);
//         return { type: 'error', message: 'Failed to parse chart data from the model.', thought: "JSON parsing error" };
//     }
// }

// async function generateTextResponse(model: any, userInput: string, chatbotGenerationConfig: ModelConfig, history: HistoryItem[], intent: string, data: string = ""): Promise<ChatResponse> {
//     const systemInstruction = getSystemInstruction(intent);

//     const textQuestionsHistory: HistoryItem[] = history.filter(entry => (entry.role === 'user' || entry.role === 'model') && entry.type === 'text')
//         .map(entry => ({
//             role: entry.role,
//             parts: [{ text: entry.parts[0].text }]
//         }));

//     if (intent === 'Conference' || intent === 'Journal') {
//         textQuestionsHistory.unshift({
//             role: 'user',
//             parts: [{ text: `**${intent} database:**\n\n${data}` }],
//         });
//     } else if (intent === 'Website') {
//         textQuestionsHistory.unshift({
//             role: 'user',
//             parts: [{ text: `**${intent} description:**\n\n${process.env.WEBSITE_DESCRIPTION || "No website description available."}` }],
//         });
//     }

//     const modelInstance = getModelWithSystemInstruction(model, systemInstruction);
//     const response = await getGeminiResponse(modelInstance, userInput, chatbotGenerationConfig, textQuestionsHistory);
//     const responseText = response.text();
//     logToFile(`Raw response from model (text): ${responseText}`);
//     return { type: 'text', message: responseText, thought: "Text response generated" }; // Add thought
// }

// // --- Utility Functions ---

// function formatHistoryEntry(entry: HistoryItem): string {
//     const role = entry.role === 'user' ? 'User' : 'Model';
//     const partsText = entry.parts.map(part => part.text).join('\n'); // Simpler, since parts are always text
//     return `${role}:\n${partsText}\n`;
// }

// async function saveHistoryToFile(history: HistoryItem[], filePath: string): Promise<void> {
//     try {
//         const formattedHistory = history.map(formatHistoryEntry).join('\n---\n');
//         await fs.writeFile(filePath, formattedHistory, 'utf-8');
//         logToFile(`Chat history saved to file: ${filePath}`);
//     } catch (error: any) {
//         logToFile(`Error saving chat history: ${error.message}`);
//     }
// }

// // --- Intent Handling Functions ---

// interface Criteria { // More general criteria
//     [key: string]: any;
// }

// interface Conference { // Example - you'll need your actual Conference structure
//     name: string;
//     date: string;
//     location?: string;  // Optional
// }

// interface Journal {   // Example - you'll need your actual Journal structure
//     title: string;
//     impactFactor?: number; // Optional
//     subjectArea: string;
// }

// async function handleFindInformationConferenceIntent(criteria: Criteria): Promise<Conference[]> {
//     logToFile(`Filtering conferences with criteria: ${JSON.stringify(criteria)}`);
//     try {
//       const conferenceResults = await filterConferences(criteria, '../evaluate.csv', './output.txt');
//       return JSON.parse(conferenceResults);
//     } catch (error) {
//       console.error("Error filtering conference data:", error);
//       return []; // Return empty array on error
//     }
// }

// async function handleFindInformationJournalIntent(criteria: Criteria): Promise<Journal[]> {
//     logToFile(`Filtering journals with criteria: ${JSON.stringify(criteria)}`);
//       try {
//         const journalResults = await filterJournals(criteria, '../scimagojr_2023.csv', './journal_output.txt');
//         return JSON.parse(journalResults);
//       } catch (error) {
//         console.error("Error filtering journal data:", error);
//         return []; // Return empty array on error
//       }
// }
// async function handleDrawChartIntent(history: HistoryItem[]): Promise<ChatResponse> {
//     return await generateChartResponse(VISUALIZE_MODEL_NAME, visualizeGenerationConfig, history);
// }

// interface UserIntentRedirect {
//     Value: string;
//     Message: string;
//     Type: 'Internal website' | 'External website';
// }

// interface UserIntent { // Keep this for the determineUserIntent result
//     Redirect?: UserIntentRedirect;
//     Intent?: string[];
//     About?: string;
//     Description?: string;
// }

// async function handleWebsiteNavigationIntent(userIntent: UserIntent): Promise<ChatResponse> {
//     if (userIntent?.Redirect?.Value && userIntent?.Redirect?.Message && userIntent?.Redirect?.Type) {
//         if (userIntent.Redirect.Type === 'Internal website') {
//             return {
//                 type: 'navigation',
//                 navigationType: 'internal',
//                 path: userIntent.Redirect.Value,
//                 message: userIntent.Redirect.Message,
//             };
//         } else if (userIntent.Redirect.Type === 'External website') {
//             return {
//                 type: 'navigation',
//                 navigationType: 'external',
//                 url: userIntent.Redirect.Value,
//                 message: userIntent.Redirect.Message,
//             };
//         } else {
//             return { type: 'error', message: "Invalid navigation type.", thought: "Invalid navigation type" };
//         }
//     } else {
//         return { type: 'error', message: "Incomplete navigation information.", thought: "Missing navigation data" };
//     }
// }

// async function handleNoIntent(): Promise<string> {
//   const greetings = [
//     "Hi there!  How can I help you with conferences, journals, or website information?",
//     "Hello!  What are you looking for today?",
//     "Welcome!  Ask me about conferences, journals, or websites.",
//   ];
//   const randomIndex = Math.floor(Math.random() * greetings.length);
//   return greetings[randomIndex];
// }

// async function handleInvalidIntent(criteria: Criteria): Promise<string> {
//     return criteria.Description || "I'm sorry, I didn't understand your request.  Could you rephrase it?";
// }

// // --- Main Chat Function ---

// async function runNonStreamChat(userInput: string, history: HistoryItem[]): Promise<ChatResponse> {
//     logToFile(`User input: ${userInput}`);
//     logToFile(`Chat history: ${JSON.stringify(history)}`);

//     try {
//         const questionList = extractUserQuestions(history).join("\n");
//         const userIntent: UserIntent | null = await determineUserIntent(questionList); // Change here
//         logToFile(`Detected user intent: ${JSON.stringify(userIntent)}`);
//         const thought = userIntent?.Description || "";

//         if (userIntent?.Intent?.includes('Draw chart')) {
//             return handleDrawChartIntent(history);
//         } else if (userIntent?.Intent?.includes('Website navigation')) {
//             return handleWebsiteNavigationIntent(userIntent);
//         } else if (userIntent?.Intent?.includes('Find information')) {
//             if (userIntent.About === 'Conference') {
//                 const conferences = await handleFindInformationConferenceIntent(userIntent);
//                 return generateTextResponse(CHATBOT_MODEL_NAME, userInput, chatbotGenerationConfig, history, 'Conference', JSON.stringify(conferences));
//             } else if (userIntent.About === 'Journal') {
//                 const journals = await handleFindInformationJournalIntent(userIntent);
//                 return generateTextResponse(CHATBOT_MODEL_NAME, userInput, chatbotGenerationConfig, history, 'Journal', JSON.stringify(journals));
//             } else if (userIntent.About === 'Website') {
//                 return generateTextResponse(CHATBOT_MODEL_NAME, userInput, chatbotGenerationConfig, history, 'Website');
//             } else {
//                 return { type: 'error', message: "Invalid 'About' property for 'Find information' intent.", thought: "Invalid 'About' value" };
//             }
//         } else if (userIntent?.Intent?.includes('No intent')) {
//             return { type: 'text', message: await handleNoIntent(), thought };
//         } else if (userIntent?.Intent?.includes('Invalid')) {
//             return { type: 'text', message: await handleInvalidIntent(userIntent), thought };
//         } else {
//             return { type: 'error', message: 'Could not determine the intent.', thought: "Intent determination failed" };
//         }

//     } catch (error: any) {
//         logToFile(`Error in runNonStreamChat: ${error}`);
//         return { type: 'error', message: error.message || 'An unexpected error occurred.', thought: "An error occurred" };
//     }
// }

// export { runNonStreamChat, saveHistoryToFile };

