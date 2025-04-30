
// --- Core Gemini API Call Function (Refactored) ---
const callGeminiAPI = async ({
    batch, batchIndex, title, acronym, apiType, systemInstruction, modelName, generationConfig, parentLogger
}: CallGeminiApiParams): Promise<ApiResponse> => {
    const baseLogContext = { apiType, batchIndex, modelName, title: title || 'N/A', acronym: acronym || 'N/A', function: 'callGeminiAPI' };
    parentLogger.info({ ...baseLogContext, event: 'gemini_call_start' }, "Preparing Gemini API call");
    const defaultResponse: ApiResponse = { responseText: "", metaData: null };

    let modelRateLimiter: RateLimiterMemory;
    try {
        modelRateLimiter = getRateLimiterForModel(modelName); // Logs internally
    } catch (limiterError: unknown) {
        const errorDetails = limiterError instanceof Error ? { name: limiterError.name, message: limiterError.message } : { details: String(limiterError) };
        parentLogger.error({ ...baseLogContext, err: errorDetails, event: 'gemini_call_limiter_init_failed' }, "Failed to get or create rate limiter. Aborting API call.");
        return defaultResponse;
    }

    const apiConfig: ApiConfig | undefined = apiConfigs[apiType];
    if (!apiConfig) {
        parentLogger.error({ ...baseLogContext, event: 'gemini_call_invalid_apitype' }, "Invalid apiType provided. Cannot find configuration.");
        return defaultResponse;
    }

    // --- Conditional Setup Based on apiType ---
    let useSystemInstruction = false;
    let useFewShotExamples = false;
    let useCache = false; // Cache is specifically tied to EXTRACT for now

    // Define which API types use which features
    if (apiType === API_TYPE_EXTRACT) {
        useSystemInstruction = true;
        useFewShotExamples = true; // Assuming extract uses few-shot examples defined in config
        useCache = true; // Enable cache logic only for Extract API
    } else if (apiType === API_TYPE_DETERMINE) {
        // Determine API should use *only* the user input 'batch'
        useSystemInstruction = false;
        useFewShotExamples = false;
        useCache = false;
    }
    // Add more 'else if' blocks here for other API types with different requirements

    parentLogger.info({
        ...baseLogContext,
        useSystemInstruction,
        useFewShotExamples,
        useCache,
        event: 'gemini_call_feature_config'
    }, "Determined feature usage for API type");

    // Prepare Few-Shot Parts (Conditionally)
    const fewShotContext = { ...baseLogContext, event_group: 'few_shot_prep' };
    const fewShotParts: Part[] = [];
    if (useFewShotExamples) {
        parentLogger.debug({ ...fewShotContext, event: 'few_shot_prep_start' }, "Preparing few-shot parts");
        try {
            const inputs = apiConfig.inputs || {};
            const outputs = apiConfig.outputs || {};
            Object.entries(inputs).forEach(([inputKey, inputValue]) => {
                const outputKey = inputKey.replace('input', 'output');
                const outputValue = outputs[outputKey] || '';
                if (inputValue) fewShotParts.push({ text: inputValue }); // Ensure value exists
                if (outputValue) fewShotParts.push({ text: outputValue }); // Ensure value exists
            });
            if (fewShotParts.length === 0) {
                 parentLogger.warn({ ...fewShotContext, event: 'few_shot_prep_empty' }, "Few-shot inputs/outputs defined in config, but resulted in empty parts array.");
            }
            parentLogger.debug({ ...fewShotContext, fewShotCount: fewShotParts.length / 2, event: 'few_shot_prep_success' }, "Prepared few-shot parts");
        } catch (fewShotError: unknown) {
            const errorDetails = fewShotError instanceof Error ? { name: fewShotError.name, message: fewShotError.message } : { details: String(fewShotError) };
            parentLogger.error({ ...fewShotContext, err: errorDetails, event: 'few_shot_prep_failed' }, "Error processing few-shot examples. Continuing without them.");
            fewShotParts.length = 0; // Clear array on error
        }
    } else {
        parentLogger.debug({ ...fewShotContext, event: 'few_shot_prep_skipped' }, "Skipping few-shot parts preparation as not required for this apiType.");
    }

    // Setup Model (Cached or Non-Cached)
    let model: GenerativeModel | undefined;
    let contentRequest: GenerateContentRequest | string; // Can be string for simple requests
    let usingCache = false;
    let currentCache: CachedContent | null = null;
    const generationModelName = modelName;

    // --- Cache Logic (Only if useCache is enabled, currently only for EXTRACT) ---
    if (useCache) {
        const cacheSetupContext = { ...baseLogContext, event_group: 'cache_setup' };
        parentLogger.debug({ ...cacheSetupContext, event: 'cache_setup_get_or_create' }, "Attempting to get or create cache");
        try {
            // Cache key depends on systemInstruction and fewShotParts, ensure they are correctly passed if needed
            const effectiveSystemInstruction = useSystemInstruction ? systemInstruction : ""; // Use actual instruction only if needed
            currentCache = await getOrCreateExtractCache(modelName, effectiveSystemInstruction, fewShotParts, parentLogger); // Logs internally
        } catch (cacheSetupError: unknown) {
            const errorDetails = cacheSetupError instanceof Error ? { name: cacheSetupError.name, message: cacheSetupError.message } : { details: String(cacheSetupError) };
            parentLogger.error({ ...cacheSetupContext, err: errorDetails, event: 'cache_setup_get_or_create_failed' }, "Critical error during cache setup, proceeding without cache");
            currentCache = null;
        }

        if (currentCache?.name) {
            parentLogger.info({ ...cacheSetupContext, cacheName: currentCache.name, event: 'cache_setup_attempt_use' }, "Attempting to use cached context object");
            try {
                if (!genAI) throw new Error("genAI not initialized");
                model = genAI.getGenerativeModelFromCachedContent(currentCache);
                contentRequest = batch; // For cached model, request is just the new user content
                usingCache = true; // Mark that we are using the cache
                parentLogger.info({ ...cacheSetupContext, cacheName: currentCache.name, event: 'cache_setup_use_success' }, "Using cached context model");
            } catch (getModelError: unknown) {
                const errorDetails = getModelError instanceof Error ? { name: getModelError.name, message: getModelError.message } : { details: String(getModelError) };
                parentLogger.error({ ...cacheSetupContext, cacheName: currentCache?.name, err: errorDetails, event: 'cache_setup_getmodel_failed' }, "Error getting model from cached content, falling back to non-cached");
                extractApiCaches.delete(modelName); // Invalidate local cache state
                await removePersistentCacheEntry(modelName, parentLogger); // Logs internally
                currentCache = null;
                usingCache = false; // Fallback to non-cached
            }
        } else {
             parentLogger.info({ ...cacheSetupContext, event: 'cache_setup_no_cache_found' }, "No valid cache object found or created, proceeding without cache.");
        }
    } // End of Cache Logic block

    // --- Non-Cached Model Setup (If not using cache or cache failed) ---
    if (!usingCache) {
        const nonCachedSetupContext = { ...baseLogContext, event_group: 'non_cached_setup' };
         if (useCache) { // Only log fallback message if caching was attempted
             parentLogger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_fallback' }, "Proceeding without cache (setup failed, error, or no cache found).");
         } else {
             parentLogger.debug({ ...nonCachedSetupContext, event: 'non_cached_setup_normal' }, "Setting up non-cached model (cache not enabled for this apiType).");
         }

        try {
            if (!genAI) throw new Error("genAI not initialized");

            // --- Model Initialization (Conditional System Instruction) ---
            const modelConfig: { model: string, systemInstruction?: Content } = {
                model: generationModelName,
            };
            if (useSystemInstruction && systemInstruction) {
                modelConfig.systemInstruction = { role: "system", parts: [{ text: systemInstruction }] };
                parentLogger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_using_system_instruction' }, "Model configured WITH system instruction.");
            } else {
                 parentLogger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_skipping_system_instruction' }, "Model configured WITHOUT system instruction.");
            }
            model = genAI.getGenerativeModel(modelConfig);
            // --- End Model Initialization ---


            // --- Content Request Construction (Conditional History/Few-Shots) ---
            if (useFewShotExamples && fewShotParts.length > 0) {
                // Construct history including few-shot examples
                const history: Content[] = [];
                for (let i = 0; i < fewShotParts.length; i += 2) {
                    if (fewShotParts[i]) history.push({ role: "user", parts: [fewShotParts[i]] });
                    if (fewShotParts[i + 1]) history.push({ role: "model", parts: [fewShotParts[i + 1]] });
                }
                history.push({ role: "user", parts: [{ text: batch }] }); // Add the current user input

                contentRequest = {
                    contents: history,
                    generationConfig: generationConfig,
                };
                parentLogger.info({ ...nonCachedSetupContext, historyLength: history.length, event: 'non_cached_setup_request_with_history' }, "Using non-cached model setup with history (few-shots + user input)");
            } else {
                 // Simple request: just the user input batch string
                 contentRequest = batch;
                 parentLogger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_request_simple' }, "Using simple non-cached model setup (user input only)");
            }
             // --- End Content Request Construction ---

        } catch (getModelError: unknown) {
            const errorDetails = getModelError instanceof Error ? { name: getModelError.name, message: getModelError.message } : { details: String(getModelError) };
            parentLogger.error({ ...nonCachedSetupContext, generationModelName, err: errorDetails, event: 'non_cached_setup_failed' }, "Error getting non-cached generative model");
            return defaultResponse; // Cannot proceed without a model
        }
    } // End of Non-Cached Setup block

    // --- Call API with Retry Logic ---
    return executeWithRetry(async (limiter): Promise<ApiResponse> => {
        const callAttemptContext = { ...baseLogContext, usingCache, cacheName: usingCache ? currentCache?.name : 'N/A', event_group: 'gemini_api_attempt' };

        if (!model) {
            parentLogger.error({ ...callAttemptContext, event: 'gemini_api_model_undefined' }, "Model object is undefined before calling generateContent.");
            throw new Error("Model is not initialized");
        }

        return await apiLimiter(async () => {
            const rateLimitKey = `${apiType}_${batchIndex}_${modelName}`;
            parentLogger.debug({ ...callAttemptContext, event: 'gemini_api_rate_limit_consume' }, `Attempting to consume rate limit points`);
            try {
                await limiter.consume(rateLimitKey, 1);
                parentLogger.debug({ ...callAttemptContext, event: 'gemini_api_rate_limit_passed' }, `Rate limit check passed. Sending request...`);
            } catch (limiterError: unknown) {
                parentLogger.warn({ ...callAttemptContext, event: 'gemini_api_rate_limit_failed' }, `Rate limit consumption failed.`);
                throw limiterError;
            }

            // --- Actual API Call ---
            let result: GenerateContentResult;
            try {
                parentLogger.info({ ...callAttemptContext, requestType: typeof contentRequest, event: 'gemini_api_generate_start' }, "Calling model.generateContent");
                // *** API Call ***
                result = await model.generateContent(contentRequest); // contentRequest is now correctly string or object
                // **************
                parentLogger.info({ ...callAttemptContext, event: 'gemini_api_generate_success' }, "model.generateContent successful");
            } catch (generateContentError: unknown) {
                 // ... (existing error handling, cache invalidation check remains relevant if cache was attempted) ...
                 const errorDetails = generateContentError instanceof Error ? { name: generateContentError.name, message: generateContentError.message } : { details: String(generateContentError) };
                 parentLogger.error({ ...callAttemptContext, err: errorDetails, event: 'gemini_api_generate_failed' }, "Error during model.generateContent");
                 if (usingCache && (errorDetails.message?.toLowerCase().includes("cachedcontent not found") || errorDetails.message?.toLowerCase().includes("permission denied"))) {
                    parentLogger.warn({ ...callAttemptContext, event: 'gemini_api_generate_invalidate_cache' }, "Invalidating cache due to generateContent error.");
                    // Invalidation should ideally happen outside/before the retry if possible,
                    // but throwing the error ensures the retry logic handles it.
                 }
                 throw generateContentError;
            }
            // --- End Actual API Call ---

            // --- Response Processing (remains largely the same) ---
            const response = result?.response;
            const feedback = response?.promptFeedback;

            if (!response) {
                 // ... (existing handling for missing response) ...
                 parentLogger.warn({ ...callAttemptContext, feedback, event: 'gemini_api_response_missing' }, "Gemini API returned result with missing response object.");
                 if (feedback?.blockReason) {
                     parentLogger.error({ ...callAttemptContext, blockReason: feedback.blockReason, safetyRatings: feedback.safetyRatings, event: 'gemini_api_response_blocked' }, "Request blocked by safety settings");
                     throw new Error(`Request blocked by safety settings: ${feedback.blockReason}`);
                 }
                 throw new Error("Empty or invalid response object from Gemini API.");
            }
             if (feedback?.blockReason) {
                 // ... (existing handling for blocked response) ...
                 parentLogger.error({ ...callAttemptContext, blockReason: feedback.blockReason, safetyRatings: feedback.safetyRatings, event: 'gemini_api_response_blocked' }, "Request blocked by safety settings (found in feedback)");
                 throw new Error(`Request blocked by safety settings: ${feedback.blockReason}`);
             }

            let responseText = "";
            try {
                responseText = response.text();
                parentLogger.debug({ ...callAttemptContext, event: 'gemini_api_text_extract_success' }, "Extracted text using response.text()");
            } catch (textError: unknown) {
                 // ... (existing fallback logic for text extraction) ...
                 const errorDetails = textError instanceof Error ? { name: textError.name, message: textError.message } : { details: String(textError) };
                 parentLogger.warn({ ...callAttemptContext, err: errorDetails, event: 'gemini_api_text_extract_failed' }, "Response.text() accessor failed, trying fallback.");
                 responseText = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
                 if (!responseText) {
                     parentLogger.warn({ ...callAttemptContext, responseStructure: response, event: 'gemini_api_text_extract_fallback_failed' }, "Could not extract text content from response via fallback.");
                 } else {
                     parentLogger.debug({ ...callAttemptContext, event: 'gemini_api_text_extract_fallback_success' }, "Extracted text using fallback");
                 }
            }

            const metaData = response.usageMetadata ?? null;

            // --- File Writing (remains the same) ---
            const safeAcronym = (acronym || 'noacronym').replace(/[^a-zA-Z0-9_.-]/g, '-');
            const responseOutputPath = path.join(RESPONSE_OUTPUT_DIR, `result_${apiType}_${modelName}_${safeAcronym}_${batchIndex}.txt`);
            const fileLogContext = { ...callAttemptContext, filePath: responseOutputPath, event_group: 'response_file_write' };
            (async () => {
                 // ... (existing file writing logic) ...
                 try {
                     if (!existsSync(RESPONSE_OUTPUT_DIR)) {
                         await fsPromises.mkdir(RESPONSE_OUTPUT_DIR, { recursive: true });
                         parentLogger.info({ directory: RESPONSE_OUTPUT_DIR, event: 'response_dir_created' }, "Created response output directory");
                     }
                     parentLogger.debug({ ...fileLogContext, event: 'response_file_write_start' }, "Writing response to file");
                     await fsPromises.writeFile(responseOutputPath, responseText || "", "utf8");
                     parentLogger.debug({ ...fileLogContext, event: 'response_file_write_success' }, "Successfully wrote response to file");
                 } catch (fileWriteError: unknown) {
                     const errorDetails = fileWriteError instanceof Error ? { name: fileWriteError.name, message: fileWriteError.message } : { details: String(fileWriteError) };
                     parentLogger.error({ ...fileLogContext, err: errorDetails, event: 'response_file_write_failed' }, "Error writing response to file");
                 }
            })();

            parentLogger.info({ ...callAttemptContext, responseLength: responseText.length, hasMetaData: !!metaData, tokens: metaData?.totalTokenCount, event: 'gemini_api_attempt_success' }, "Gemini API request processed successfully for this attempt.");
            return { responseText, metaData };

        }); // End apiLimiter wrapper

    }, apiType, batchIndex, modelName, modelRateLimiter, parentLogger); // End executeWithRetry call
};

// --- Exported API Functions ---

// Keep extract_information_api as it was (it implicitly benefits from the conditional logic now)
let extractModelIndex: number = 0; // Assuming this state management is intentional

export const extract_information_api = async (
    batch: string,
    batchIndex: number,
    title: string,
    acronym: string | undefined,
    parentLogger: typeof logger // Assuming logger is your actual logger instance
): Promise<ApiResponse> => {
    const apiType = API_TYPE_EXTRACT;
    const config: ApiConfig | undefined = apiConfigs[apiType];
    const defaultResponse: ApiResponse = { responseText: "", metaData: null };
    const baseLogContext = { apiType, batchIndex, title: title || 'N/A', acronym: acronym || 'N/A', function: 'extract_information_api' };

    if (!config) {
        parentLogger.error(baseLogContext, "Configuration not found.");
        return defaultResponse;
    }
    const modelNames = config.modelNames;
    if (!modelNames || modelNames.length === 0) {
        parentLogger.error(baseLogContext, "No model names configured.");
        return defaultResponse;
    }

    const selectedModelName = modelNames[extractModelIndex];
    const nextIndex = (extractModelIndex + 1) % modelNames.length;
    parentLogger.debug({ ...baseLogContext, selectedModel: selectedModelName, nextIndex }, "Initiating API call (round-robin)");
    extractModelIndex = nextIndex;

    try {
        // Pass systemInstruction as before. callGeminiAPI will use it because apiType is EXTRACT.
        const { responseText, metaData } = await callGeminiAPI({
            batch, batchIndex, title, acronym, apiType,
            systemInstruction: config.systemInstruction || "", // Pass the instruction
            modelName: selectedModelName,
            generationConfig: config.generationConfig,
            parentLogger: parentLogger
        });

        // JSON Cleaning Logic (remains the same)
        // ... (keep your existing JSON cleaning logic here) ...
        const firstCurly = responseText.indexOf('{');
        const lastCurly = responseText.lastIndexOf('}');
        let cleanedResponseText = "";
        const cleaningLogContext = { ...baseLogContext, modelUsed: selectedModelName };

        if (firstCurly !== -1 && lastCurly !== -1 && lastCurly >= firstCurly) {
            const potentialJson = responseText.substring(firstCurly, lastCurly + 1);
            try {
                JSON.parse(potentialJson); // Validate
                cleanedResponseText = potentialJson.trim();
                parentLogger.debug(cleaningLogContext, "Successfully cleaned and validated JSON response.");
            } catch (parseError: unknown) {
                const errorDetails = parseError instanceof Error ? { name: parseError.name, message: parseError.message } : { details: String(parseError) };
                parentLogger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200), err: errorDetails }, "Failed to parse extracted text as JSON after cleaning, returning empty string.");
                cleanedResponseText = ""; // Ensure empty on error
            }
        } else {
            parentLogger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200) }, "Could not find valid JSON structure ({...}) in response, returning empty string.");
            cleanedResponseText = ""; // Ensure empty
        }

        parentLogger.info({ ...cleaningLogContext, cleanedResponseLength: cleanedResponseText.length }, "API call finished.");
        return { responseText: cleanedResponseText, metaData };

    } catch (error: unknown) {
        const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
        parentLogger.error({ ...baseLogContext, modelUsed: selectedModelName, err: errorDetails }, "Unhandled error in main function");
        return defaultResponse;
    }
};


// --- Modified determine_links_api Function ---
export const determine_links_api = async (
    batch: string,
    batchIndex: number,
    title: string | undefined,
    acronym: string | undefined,
    parentLogger: typeof logger // Assuming logger is your actual logger instance
): Promise<ApiResponse> => {

    const apiType = API_TYPE_DETERMINE;
    const config: ApiConfig | undefined = apiConfigs[apiType];
    const defaultResponse: ApiResponse = { responseText: "", metaData: null };
    const baseLogContext = { apiType, batchIndex, title: title || 'N/A', acronym: acronym || 'N/A', function: 'determine_links_api' };

    if (!config) {
        parentLogger.error(baseLogContext, "Configuration not found.");
        return defaultResponse;
    }
    const modelName = config.modelName; // Assuming determine uses a single model specified in config
    if (!modelName) {
        parentLogger.error(baseLogContext, "No model name configured.");
        return defaultResponse;
    }
    const logContextWithModel = { ...baseLogContext, modelName };
    parentLogger.debug(logContextWithModel, "Initiating API call");

    try {
        // *** No longer prepare or use systemInstruction here ***
        // const systemInstruction = (config.systemInstruction || "")
        //     .replace(/\${Title}/g, title || 'N/A')
        //     .replace(/\${Acronym}/g, acronym || 'N/A');

        // Call the central API function. Pass an empty string for systemInstruction.
        // callGeminiAPI will ignore it based on the apiType = API_TYPE_DETERMINE.
        // It will also skip few-shot examples based on the apiType.
        const { responseText, metaData } = await callGeminiAPI({
            batch, batchIndex, title, acronym, apiType,
            systemInstruction: "", // Pass empty - it will be ignored internally
            modelName: modelName,
            generationConfig: config.generationConfig,
            parentLogger: parentLogger
        });

        // JSON Cleaning Logic (remains the same)
        // ... (keep your existing JSON cleaning logic here) ...
        const firstCurly = responseText.indexOf('{');
        const lastCurly = responseText.lastIndexOf('}');
        let cleanedResponseText = "";
        const cleaningLogContext = { ...logContextWithModel };

        if (firstCurly !== -1 && lastCurly !== -1 && lastCurly >= firstCurly) {
            const potentialJson = responseText.substring(firstCurly, lastCurly + 1);
            try {
                JSON.parse(potentialJson); // Validate
                cleanedResponseText = potentialJson.trim();
                parentLogger.debug(cleaningLogContext, "Successfully cleaned and validated JSON response.");
            } catch (parseError: unknown) {
                const errorDetails = parseError instanceof Error ? { name: parseError.name, message: parseError.message } : { details: String(parseError) };
                parentLogger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200), err: errorDetails }, "Failed to parse extracted text as JSON after cleaning, returning empty string.");
                 cleanedResponseText = ""; // Ensure empty on error
            }
        } else {
            parentLogger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200) }, "Could not find valid JSON structure ({...}) in response, returning empty string.");
             cleanedResponseText = ""; // Ensure empty
        }

        parentLogger.info({ ...cleaningLogContext, cleanedResponseLength: cleanedResponseText.length }, "API call finished.");
        return { responseText: cleanedResponseText, metaData };

    } catch (error: unknown) {
        const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
        parentLogger.error({ ...logContextWithModel, err: errorDetails }, "Unhandled error in main function");
        return defaultResponse;
    }
};