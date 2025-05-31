// src/chatbot/handlers/getConferences.handler.ts
import { executeGetConferences } from '../services/getConferences.service';
import { IFunctionHandler } from '../interface/functionHandler.interface';
import {
    FunctionHandlerInput,
    FunctionHandlerOutput,
    StatusUpdatePayload,
    ThoughtStep,
    FrontendAction,
    DisplayConferenceSourcesPayload
} from '../shared/types';
import logToFile from '../../utils/logger';
import { getErrorMessageAndStack } from '../../utils/errorUtils';

// Helper function để trích xuất và format ngày (tương tự như trong transformData)
// Bạn có thể đặt nó ở một file utils chung nếu dùng ở nhiều nơi
const formatDateRangeForSource = (fromDateStr?: string | null, toDateStr?: string | null): string | undefined => {
    if (!fromDateStr) return undefined;
    try {
        const fromDate = new Date(fromDateStr);
        const toDate = toDateStr ? new Date(toDateStr) : fromDate;
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) return undefined;

        const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
        const yearOption: Intl.DateTimeFormatOptions = { year: 'numeric' };
        const fromFormatted = fromDate.toLocaleDateString('en-US', options);
        const toFormatted = toDate.toLocaleDateString('en-US', options);
        const year = fromDate.toLocaleDateString('en-US', yearOption);

        if (fromDate.toDateString() === toDate.toDateString()) {
            return `${fromFormatted}, ${year}`;
        } else {
            if (fromDate.getFullYear() === toDate.getFullYear() && fromDate.getMonth() === toDate.getMonth()) {
                const fromDay = fromDate.toLocaleDateString('en-US', { day: 'numeric' });
                const toDay = toDate.toLocaleDateString('en-US', { day: 'numeric' });
                const month = fromDate.toLocaleDateString('en-US', { month: 'short' });
                return `${month} ${fromDay}-${toDay}, ${year}`;
            } else {
                return `${fromFormatted} - ${toFormatted}, ${year}`;
            }
        }
    } catch (error) {
        return undefined;
    }
};


export class GetConferencesHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const {
            args,
            handlerId: handlerProcessId,
            socketId,
            onStatusUpdate,
            agentId
        } = context;

        const logPrefix = `[${handlerProcessId} ${socketId} Handler:GetConferences Agent:${agentId}]`;
        const searchQuery = args?.searchQuery as string | undefined;
        const dataType = "conference";
        const localThoughts: ThoughtStep[] = [];

        logToFile(`${logPrefix} Executing with args: ${JSON.stringify(args)}`);

        const reportStep = (step: string, message: string, details?: object): void => {
            const timestamp = new Date().toISOString();
            const thought: ThoughtStep = {
                step, message, details, timestamp, agentId: agentId,
            };
            localThoughts.push(thought);
            logToFile(`${logPrefix} Thought added: Step: ${step}, Agent: ${agentId}`);
            if (onStatusUpdate) {
                const statusData: StatusUpdatePayload = {
                    type: 'status', step, message, details, timestamp, agentId: agentId,
                };
                onStatusUpdate('status_update', statusData);
            } else {
                logToFile(`${logPrefix} Warning: onStatusUpdate callback not provided for step: ${step}`);
            }
        };

        try {
            reportStep('validating_function_args', `Validating arguments for getting ${dataType}...`, { args });

            if (!searchQuery || typeof searchQuery !== 'string' || searchQuery.trim() === '') {
                const errorMsg = "Missing or empty search query for conferences.";
                logToFile(`${logPrefix} Validation Failed - ${errorMsg}`);
                reportStep('function_error', `Invalid arguments: ${errorMsg}`, { error: errorMsg, args });
                return {
                    modelResponseContent: `Error: ${errorMsg} Please provide a search query for conferences.`,
                    frontendAction: undefined,
                    thoughts: localThoughts
                };
            }

            reportStep('retrieving_info', `Retrieving ${dataType} data for query: "${searchQuery}"...`, { dataType, searchQuery });
            const apiResult = await executeGetConferences(searchQuery); // executeGetConferences trả về ApiCallResult
            logToFile(`${logPrefix} API Result: Success=${apiResult.success}, Query="${searchQuery}"`);

            let modelResponseContent: string;
            let frontendAction: FrontendAction = undefined; // Khởi tạo frontendAction

            if (apiResult.success) {
                reportStep('api_call_success', `API call for ${dataType} succeeded. Processing data...`, { query: searchQuery });

                if (apiResult.formattedData) { // Sử dụng formattedData từ ApiCallResult
                    modelResponseContent = apiResult.formattedData;
                    reportStep('data_found', `Successfully retrieved and processed ${dataType} data.`, { success: true, query: searchQuery, resultPreview: modelResponseContent.substring(0, 100) + "..." });

                    // <<< TẠO FRONTEND ACTION TẠI ĐÂY >>>
                    // Kiểm tra xem apiResult.rawData có phải là object và có payload không
                    if (apiResult.rawData && typeof apiResult.rawData === 'string') {
                        try {
                            const parsedRawData = JSON.parse(apiResult.rawData);
                            if (parsedRawData && Array.isArray(parsedRawData.payload) && parsedRawData.payload.length > 0) {
                                const conferencesForFrontend: DisplayConferenceSourcesPayload['conferences'] = parsedRawData.payload.map((conf: any) => {
                                    // Trích xuất thông tin cần thiết từ mỗi conference object
                                    // Giả sử cấu trúc của conf object dựa trên transformConferenceData
                                    const latestOrg = Array.isArray(conf.organizations) && conf.organizations.length > 0
                                        ? conf.organizations[conf.organizations.length - 1]
                                        : conf; // Fallback to conf if organizations is not as expected

                                    const rankInfo = Array.isArray(latestOrg.ranks) && latestOrg.ranks.length > 0
                                        ? latestOrg.ranks[0] // Lấy rank đầu tiên làm đại diện
                                        : { rank: 'N/A', source: 'N/A' };

                                    const location = latestOrg.locations && latestOrg.locations.length > 0
                                        ? latestOrg.locations[0]
                                        : {};
                                    
                                    let formattedLocation = "N/A";
                                    if (location.cityStateProvince && location.country) {
                                        formattedLocation = `${location.cityStateProvince}, ${location.country}`;
                                    } else if (location.country) {
                                        formattedLocation = location.country;
                                    } else if (location.address) { // Fallback to address if city/country not available
                                        formattedLocation = location.address;
                                    }


                                    return {
                                        id: conf.id || 'unknown-id',
                                        title: latestOrg.title || conf.title || 'Untitled Conference',
                                        acronym: latestOrg.acronym || conf.acronym,
                                        rank: rankInfo.rank,
                                        source: rankInfo.source,
                                        conferenceDates: formatDateRangeForSource(latestOrg.dates?.find((d:any) => d.type === 'conferenceDates')?.fromDate, latestOrg.dates?.find((d:any) => d.type === 'conferenceDates')?.toDate),
                                        location: formattedLocation,
                                    };
                                }).slice(0, 5); // Giới hạn số lượng hiển thị, ví dụ 5

                                if (conferencesForFrontend.length > 0) {
                                    frontendAction = {
                                        type: 'displayConferenceSources',
                                        payload: {
                                            conferences: conferencesForFrontend,
                                            title: `Found Conferences (Sources):`
                                        }
                                    };
                                    logToFile(`${logPrefix} Created 'displayConferenceSources' action with ${conferencesForFrontend.length} items.`);
                                }
                            }
                        } catch (parseError) {
                            logToFile(`${logPrefix} Error parsing rawData for frontend action: ${getErrorMessageAndStack(parseError).message}`);
                        }
                    }
                    // <<< KẾT THÚC TẠO FRONTEND ACTION >>>

                } else { // formattedData là null nhưng API thành công (có thể rawData có)
                    modelResponseContent = apiResult.rawData ?? (apiResult.errorMessage || `Received raw ${dataType} data for "${searchQuery}", but formatting was unavailable.`);
                    const warningMsg = `Data formatting issue for ${dataType}. Displaying raw data or error message.`;
                    logToFile(`${logPrefix} Warning: ${warningMsg}`);
                    reportStep('function_warning', warningMsg, {
                        rawDataPreview: typeof apiResult.rawData === 'string' ? apiResult.rawData.substring(0, 100) + '...' : '[object]',
                        errorMessage: apiResult.errorMessage,
                        query: searchQuery
                    });
                    reportStep('data_found_with_formatting_issues', `Retrieved ${dataType} data, but with formatting issues.`, { success: true, formattingIssue: true, query: searchQuery });
                }
            } else { // API call thất bại
                modelResponseContent = apiResult.errorMessage || `Failed to retrieve ${dataType} data for query: "${searchQuery}".`;
                logToFile(`${logPrefix} API call failed: ${modelResponseContent}`);
                reportStep('api_call_failed', `API call failed for ${dataType}: ${modelResponseContent}`, { error: modelResponseContent, success: false, query: searchQuery });
            }

            reportStep('function_result_prepared', `Result for GetConferences prepared.`, { success: apiResult.success });
            return {
                modelResponseContent,
                frontendAction, // <<< TRẢ VỀ ACTION MỚI
                thoughts: localThoughts
            };

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logToFile(`${logPrefix} CRITICAL Error: ${errorMessage}\nStack: ${errorStack}`);
            reportStep('function_error', `Critical error during ${dataType} retrieval: ${errorMessage}`, { error: errorMessage, stack: errorStack });
            return {
                modelResponseContent: `An unexpected error occurred while trying to get conferences: ${errorMessage}`,
                frontendAction: undefined,
                thoughts: localThoughts
            };
        }
    }
}