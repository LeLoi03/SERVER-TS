// src/services/resultProcessing.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import fs from 'fs';
import readline from 'readline';
import { ParserOptions, Transform as Json2CsvTransform } from '@json2csv/node';
import { Readable, Transform as NodeTransform } from 'stream';
import { pipeline as streamPipeline } from 'stream/promises';
import path from 'path';

import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
import { ProcessedRowData, InputRowData, ProcessedResponseData } from '../types/crawl.types';
import { readContentFromFile } from '../conference/11_utils';


@singleton()
export class ResultProcessingService {
    private readonly serviceBaseLogger: Logger;
    private readonly finalJsonlPath: string;
    private readonly evaluateCsvPath: string;

    private readonly VALID_CONTINENTS = new Set(['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Antarctica']);
    private readonly VALID_TYPES = new Set(['Hybrid', 'Online', 'Offline']);
    private readonly YEAR_REGEX = /^\d{4}$/;
    private readonly CSV_FIELDS: (keyof ProcessedRowData | { label: string; value: keyof ProcessedRowData })[] = [
        "title", "acronym", "link", "cfpLink", "impLink",
        "information", "conferenceDates", "year",
        "location", "cityStateProvince", "country", "continent", "type",
        "submissionDate", "notificationDate", "cameraReadyDate", "registrationDate",
        "otherDate", "topics", "publisher", "summary", "callForPapers"
    ];

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger({ service: 'ResultProcessingServiceBase' });
        this.finalJsonlPath = this.configService.finalOutputJsonlPath;
        this.evaluateCsvPath = this.configService.evaluateCsvPath;
        this.serviceBaseLogger.info("ResultProcessingService initialized.");
    }

    private getMethodLogger(parentLogger: Logger | undefined, methodName: string, additionalContext?: object): Logger {
        const base = parentLogger || this.serviceBaseLogger;
        return base.child({ serviceMethod: `ResultProcessingService.${methodName}`, ...additionalContext });
    }

    private _toCamelCase(str: string, logger: Logger): string {
        if (!str) return "";
        try {
            return String(str).replace(/(?:^\w|[A-Z]|\b\w|\s+)/g, (match, index) => {
                if (+match === 0) return ""; // Bỏ qua số 0 đứng đầu
                return index === 0 ? match.toLowerCase() : match.toUpperCase();
            }).replace(/[^a-zA-Z0-9]+/g, ''); // Loại bỏ các ký tự không phải chữ và số
        } catch (camelCaseError: unknown) {
            const message = camelCaseError instanceof Error ? camelCaseError.message : String(camelCaseError);
            logger.error({ err: message, input: str, func: '_toCamelCase' }, "Error converting to camelCase");
            return ""; // Trả về chuỗi rỗng nếu có lỗi
        }
    }

    private _isDateDetailKey(key: string): key is keyof Pick<ProcessedResponseData, 'submissionDate' | 'notificationDate' | 'cameraReadyDate' | 'registrationDate' | 'otherDate'> {
        return ["submissionDate", "notificationDate", "cameraReadyDate", "registrationDate", "otherDate"].includes(key);
    }

    private _isDirectStringKey(key: string): key is keyof Omit<ProcessedResponseData, 'submissionDate' | 'notificationDate' | 'cameraReadyDate' | 'registrationDate' | 'otherDate' | 'information' | 'summary' | 'callForPapers'> {
        return ["conferenceDates", "year", "location", "cityStateProvince", "country", "continent", "type", "topics", "publisher"].includes(key);
    }

    private _processApiResponse(response: Record<string, any> | null | undefined, logger: Logger): Omit<ProcessedResponseData, 'summary' | 'callForPapers'> {
        const result: Omit<ProcessedResponseData, 'summary' | 'callForPapers'> & { information: string } = {
            conferenceDates: "", year: "", location: "", cityStateProvince: "", country: "",
            continent: "", type: "", submissionDate: {}, notificationDate: {}, cameraReadyDate: {},
            registrationDate: {}, otherDate: {}, topics: "", publisher: "", information: ""
        };

        if (!response) return result;

        try {
            for (const key in response) {
                if (Object.prototype.hasOwnProperty.call(response, key)) {
                    const value = response[key];
                    const camelCaseKey = this._toCamelCase(key, logger);

                    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                        if (this._isDateDetailKey(camelCaseKey)) {
                            result[camelCaseKey] = {}; // Khởi tạo object cho date detail
                            for (const subKey in value) {
                                if (Object.prototype.hasOwnProperty.call(value, subKey)) {
                                    const subValue = String(value[subKey] ?? '');
                                    result[camelCaseKey][subKey] = subValue;
                                    result.information += `${key}.${subKey}: ${subValue}\n`; // Thêm key gốc để dễ hiểu
                                }
                            }
                        } else {
                            // Các object khác không phải date detail (trừ summary, callForPapers)
                            if (camelCaseKey !== "summary" && camelCaseKey !== "callForPapers") {
                                try {
                                    result.information += `${key}: ${JSON.stringify(value)}\n`;
                                } catch (stringifyError) {
                                    logger.warn({ err: stringifyError, key, func: '_processApiResponse' }, "Error stringifying object for information field");
                                    result.information += `${key}: [Error stringifying object]\n`;
                                }
                            }
                        }
                    } else {
                        // Giá trị không phải object (hoặc là array, null)
                        const stringValue = String(value ?? '');
                        if (this._isDirectStringKey(camelCaseKey)) {
                            result[camelCaseKey] = stringValue;
                        }
                        // Luôn thêm vào information (trừ summary, callForPapers)
                        if (camelCaseKey !== "summary" && camelCaseKey !== "callForPapers") {
                            result.information += `${key}: ${stringValue}\n`;
                        }
                    }
                }
            }
            result.information = result.information.trim();
        } catch (responseProcessingError: unknown) {
            logger.error({ err: responseProcessingError, func: '_processApiResponse' }, "Error processing API response content");
        }
        return result;
    }

    private async *_processJsonlStream(jsonlFilePath: string, parentProcLogger: Logger): AsyncGenerator<ProcessedRowData | null> {
        const fileStream = fs.createReadStream(jsonlFilePath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
        const streamLogger = parentProcLogger.child({ streamProcess: 'jsonlStreamProcessing', file: path.basename(jsonlFilePath) });
        let lineNumber = 0;

        for await (const line of rl) {
            lineNumber++;
            const lineLogger = streamLogger.child({ lineNumber });
            if (!line.trim()) {
                lineLogger.trace("Skipping empty line.");
                continue;
            }

            let inputRow: InputRowData | null = null;
            let acronym: string | undefined = undefined;
            let title: string | undefined = undefined;

            try {
                inputRow = JSON.parse(line) as InputRowData;
                acronym = inputRow?.conferenceAcronym;
                title = inputRow?.conferenceTitle;

                if (!inputRow || !acronym || !title) {
                    lineLogger.warn({ event: 'jsonl_missing_core_data', hasInputRow: !!inputRow, hasAcronym: !!acronym, hasTitle: !!title, lineContentSubstring: line.substring(0, 100) }, "Parsed line missing essential data, skipping row.");
                    yield null;
                    continue;
                }

            } catch (parseError: any) {
                lineLogger.error({ err: parseError, lineContentSubstring: line.substring(0, 100), event: 'jsonl_parse_error' }, "Failed to parse line in JSONL file, skipping row.");
                yield null;
                continue;
            }

            const rowContextLogger = lineLogger.child({ acronym, title });

            let parsedDetermineInfo: Record<string, any> = {};
            let parsedExtractInfo: Record<string, any> = {};
            let parsedCfpInfo: Record<string, any> = {};

            try {
                if (inputRow.determineResponseTextPath) {
                    try {
                        // Giả sử readContentFromFile có thể ném lỗi nếu file không tồn tại hoặc không đọc được
                        const content = await readContentFromFile(inputRow.determineResponseTextPath);
                        const cleaned = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim(); // Loại bỏ ký tự control
                        parsedDetermineInfo = cleaned ? JSON.parse(cleaned) : {};
                        if (typeof parsedDetermineInfo !== 'object' || parsedDetermineInfo === null) parsedDetermineInfo = {};
                    } catch (e: any) {
                        rowContextLogger.warn({ err: e, path: inputRow.determineResponseTextPath, type: 'determine', event: 'file_read_parse_warn' }, `Warning reading/parsing determine file, using empty object.`);
                    }
                }
                if (inputRow.extractResponseTextPath) {
                    try {
                        const content = await readContentFromFile(inputRow.extractResponseTextPath);
                        const cleaned = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
                        parsedExtractInfo = cleaned ? JSON.parse(cleaned) : {};
                        if (typeof parsedExtractInfo !== 'object' || parsedExtractInfo === null) parsedExtractInfo = {};
                    } catch (e: any) {
                        rowContextLogger.warn({ err: e, path: inputRow.extractResponseTextPath, type: 'extract', event: 'file_read_parse_warn' }, `Warning reading/parsing extract file, using empty object.`);
                    }
                }
                if (inputRow.cfpResponseTextPath) {
                    try {
                        const content = await readContentFromFile(inputRow.cfpResponseTextPath);
                        const cleaned = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
                        parsedCfpInfo = cleaned ? JSON.parse(cleaned) : {};
                        if (typeof parsedCfpInfo !== 'object' || parsedCfpInfo === null) parsedCfpInfo = {};
                    } catch (e: any) {
                        rowContextLogger.warn({ err: e, path: inputRow.cfpResponseTextPath, type: 'cfp', event: 'file_read_parse_warn' }, `Warning reading/parsing CFP file, using empty object.`);
                    }
                }

                const processedExtractResponse = this._processApiResponse(parsedExtractInfo, rowContextLogger);
                const finalRow: ProcessedRowData = {
                    title: title, // Đã lấy từ inputRow và kiểm tra
                    acronym: acronym.replace(/_\d+$/, ''), // Loại bỏ suffix _<số> nếu có
                    link: inputRow.conferenceLink || "",
                    cfpLink: inputRow.cfpLink || "",
                    impLink: inputRow.impLink || "",
                    determineLinks: parsedDetermineInfo, // Đây là object, không phải string
                    ...processedExtractResponse,
                    summary: String(parsedCfpInfo?.summary ?? parsedCfpInfo?.Summary ?? ''), // Xử lý cả "Summary"
                    callForPapers: String(parsedCfpInfo?.callForPapers ?? parsedCfpInfo?.['Call for Papers'] ?? parsedCfpInfo?.['Call For Papers'] ?? parsedCfpInfo?.cfp ?? ''), // Xử lý các biến thể
                };

                // --- Validation & Normalization ---
                const originalContinent = finalRow.continent?.trim();
                if (!originalContinent) {
                    // NORMALIZE: Gán giá trị mặc định khi rỗng
                    finalRow.continent = "No continent";
                    // LOG NORMALIZATION (nếu muốn)
                    rowContextLogger.info({
                        event: 'normalization_applied', // EVENT
                        field: 'continent',
                        originalValue: originalContinent, // Là undefined hoặc ""
                        normalizedValue: "No continent",
                        reason: 'empty_value',
                        conferenceAcronym: acronym, // Đảm bảo context có trong log entry
                        conferenceTitle: title
                    }, `Continent was empty, normalized to "No continent".`);
                } else if (!this.VALID_CONTINENTS.has(originalContinent)) {
                    // VALIDATION WARNING và NORMALIZE
                    rowContextLogger.info({ // Giữ info vì nó cũng là 1 dạng "cảnh báo" về dữ liệu đầu vào
                        event: 'validation_warning', // EVENT
                        field: 'continent',
                        invalidValue: originalContinent,
                        action: 'normalized', // Hành động là normalize
                        normalizedTo: 'No continent', // Giá trị sau khi normalize
                        conferenceAcronym: acronym,
                        conferenceTitle: title
                    }, `Invalid continent "${originalContinent}". Normalizing to "No continent".`);
                    finalRow.continent = "No continent";
                }

                const originalType = finalRow.type?.trim();
                if (!originalType) {
                    // NORMALIZE
                    finalRow.type = "Offline";
                    // LOG NORMALIZATION (nếu muốn)
                    rowContextLogger.info({
                        event: 'normalization_applied', // EVENT
                        field: 'type',
                        originalValue: originalType,
                        normalizedValue: "Offline",
                        reason: 'empty_value',
                        conferenceAcronym: acronym,
                        conferenceTitle: title
                    }, `Type was empty, normalized to "Offline".`);
                } else if (!this.VALID_TYPES.has(originalType)) {
                    // VALIDATION WARNING và NORMALIZE
                    rowContextLogger.info({
                        event: 'validation_warning', // EVENT
                        field: 'type',
                        invalidValue: originalType,
                        action: 'normalized',
                        normalizedTo: 'Offline',
                        conferenceAcronym: acronym,
                        conferenceTitle: title
                    }, `Invalid type "${originalType}". Normalizing to "Offline".`);
                    finalRow.type = "Offline";
                }

                // Normalization cho các trường text rỗng
                const fieldsToNormalizeIfEmpty: { field: keyof ProcessedRowData, defaultValue: string }[] = [
                    { field: 'location', defaultValue: "No location" },
                    { field: 'cityStateProvince', defaultValue: "No city/state/province" },
                    { field: 'country', defaultValue: "No country" },
                    { field: 'publisher', defaultValue: "No publisher" },
                    { field: 'topics', defaultValue: "No topics" },
                    { field: 'summary', defaultValue: "No summary available" },
                    { field: 'callForPapers', defaultValue: "No call for papers available" }
                ];

                for (const item of fieldsToNormalizeIfEmpty) {
                    const currentValue = String(finalRow[item.field] ?? '').trim(); // Ép kiểu về string trước khi trim
                    if (!currentValue) {
                        (finalRow as any)[item.field] = item.defaultValue; // Gán giá trị mặc định
                        // LOG NORMALIZATION
                        rowContextLogger.info({
                            event: 'normalization_applied', // EVENT
                            field: item.field,
                            originalValue: currentValue, // Là ""
                            normalizedValue: item.defaultValue,
                            reason: 'empty_value',
                            conferenceAcronym: acronym,
                            conferenceTitle: title
                        }, `${item.field} was empty, normalized to "${item.defaultValue}".`);
                    }
                }

                const originalYear = finalRow.year?.trim();
                if (originalYear && !this.YEAR_REGEX.test(originalYear)) {
                    // VALIDATION WARNING (chỉ log, không normalize ở đây)
                    rowContextLogger.info({ // Giữ info vì nó cũng là 1 dạng "cảnh báo" về dữ liệu đầu vào
                        event: 'validation_warning', // EVENT
                        field: 'year',
                        invalidValue: originalYear,
                        action: 'logged_only', // Hành động chỉ là log
                        conferenceAcronym: acronym,
                        conferenceTitle: title
                    }, `Invalid year format "${originalYear}". Value kept as is.`);
                }
                rowContextLogger.trace({ event: 'row_processed_successfully' }, "Row processed for yielding.");
                yield finalRow;

            } catch (rowProcessingError: any) {
                rowContextLogger.error({ err: rowProcessingError, event: 'row_processing_error' }, "Error processing row data after parsing JSONL, skipping row.");
                yield null;
            }
        }
        streamLogger.info({ totalLinesProcessed: lineNumber, event: 'jsonl_processing_finished' }, 'Finished processing JSONL file stream');
    }

    public async _writeCSVAndCollectDataInternal(
        jsonlFilePath: string,
        originalCsvFilePath: string,
        parentProcLogger: Logger
    ): Promise<ProcessedRowData[]> {
        let extractedRequestId: string | undefined;

        // Cố gắng lấy requestId từ bindings() nếu có
        if (parentProcLogger && typeof (parentProcLogger as any).bindings === 'function') {
            const bindings = (parentProcLogger as any).bindings();
            if (bindings && typeof bindings.requestId === 'string' && bindings.requestId.length > 0) {
                extractedRequestId = bindings.requestId;
            } else {
                parentProcLogger.warn({
                    event: 'requestId_not_found_in_bindings',
                    bindingsFound: !!bindings,
                    requestIdType: typeof bindings?.requestId,
                    requestIdValue: bindings?.requestId,
                }, 'requestId không tìm thấy hoặc không hợp lệ trong logger bindings.');
            }
        }

        // Nếu không tìm thấy trong bindings, thử truy cập trực tiếp (ít khả năng hơn)
        if (!extractedRequestId && parentProcLogger && typeof (parentProcLogger as any).requestId === 'string' && (parentProcLogger as any).requestId.length > 0) {
            extractedRequestId = (parentProcLogger as any).requestId;
        }

        // Sử dụng giá trị mặc định nếu không tìm thấy ở đâu cả
        const finalRequestId = extractedRequestId || 'unknownRequestId';
        if (finalRequestId === 'unknownRequestId' && extractedRequestId !== 'unknownRequestId') {
            parentProcLogger.warn({
                event: 'requestId_fallback_to_unknown',
                attemptedRequestId: extractedRequestId
            }, 'requestId không được trích xuất, sử dụng "unknownRequestId".');
        }


        const outputDir = path.dirname(originalCsvFilePath);
        const fileExtension = path.extname(originalCsvFilePath);
        const baseFilename = path.basename(originalCsvFilePath, fileExtension);

        // Tạo tên file CSV mới với finalRequestId
        const finalCsvFilename = `${baseFilename}_${finalRequestId}${fileExtension}`;
        const csvFilePath = path.join(outputDir, finalCsvFilename);

        const taskLogger = parentProcLogger.child({
            csvTask: 'writeCSVAndCollectData',
            jsonlInputFile: path.basename(jsonlFilePath),
            csvOutputFile: path.basename(csvFilePath), // Sử dụng tên file đã được sửa đổi
            // requestId sẽ tự động được kế thừa từ parentProcLogger nếu logger hỗ trợ
        });

        // Ghi log tên file CSV cuối cùng và requestId được sử dụng
        taskLogger.info({
            event: 'csv_stream_collect_start',
            usedRequestId: finalRequestId,
            finalCsvPath: csvFilePath
        }, 'Bắt đầu stream ghi CSV và thu thập dữ liệu');

        const collectedData: ProcessedRowData[] = [];
        let rowObjectStream: Readable | null = null;
        let filterLogCollectTransform: NodeTransform | null = null;
        let csvTransform: Json2CsvTransform<ProcessedRowData, ProcessedRowData> | null = null;
        let csvWriteStream: fs.WriteStream | null = null;
        let recordsProcessed = 0;
        let recordsWrittenToCsv = 0;

        try {
            rowObjectStream = Readable.from(this._processJsonlStream(jsonlFilePath, taskLogger));

            filterLogCollectTransform = new NodeTransform({
                objectMode: true,
                transform: (chunk: ProcessedRowData | null, encoding, callback) => {
                    recordsProcessed++;
                    if (chunk !== null && chunk.acronym && chunk.title) {
                        taskLogger.info({
                            event: 'csv_record_processed_for_writing',
                            conferenceAcronym: chunk.acronym,
                            conferenceTitle: chunk.title,
                        }, `Bản ghi cho ${chunk.acronym} đã xử lý và đang chuẩn bị để ghi vào CSV.`);

                        taskLogger.trace({ event: 'csv_record_to_write_internal', acronym: chunk.acronym, title: chunk.title }, `Chuyển bản ghi sang CSV transform (internal trace)`);
                        collectedData.push(chunk);
                        recordsWrittenToCsv++;
                        callback(null, chunk);
                    } else {
                        if (chunk !== null) {
                            taskLogger.warn({ event: 'csv_invalid_record_skipped_in_transform', recordData: { acronym: chunk.acronym, title: chunk.title } }, 'Bản ghi không hợp lệ bị bỏ qua trong transform để ghi CSV');
                        } else {
                            taskLogger.warn({ event: 'csv_null_record_skipped_in_transform' }, 'Bản ghi null bị bỏ qua trong transform để ghi CSV');
                        }
                        callback(); // Bỏ qua chunk không hợp lệ hoặc null
                    }
                }
            });

            const csvOptions: ParserOptions<ProcessedRowData, ProcessedRowData> = { fields: this.CSV_FIELDS };
            csvTransform = new Json2CsvTransform(csvOptions, {}, { objectMode: true });

            const csvDir = path.dirname(csvFilePath);
            if (!fs.existsSync(csvDir)) {
                taskLogger.info({ directory: csvDir, event: 'create_csv_directory' }, "Tạo thư mục cho output CSV.");
                await fs.promises.mkdir(csvDir, { recursive: true });
            }
            csvWriteStream = fs.createWriteStream(csvFilePath);

            csvWriteStream.on('error', (err) => {
                taskLogger.error({ err, event: 'csv_writestream_error', finalCsvFile: csvFilePath }, 'Lỗi từ WriteStream của CSV.');
            });
            csvWriteStream.on('finish', () => {
                taskLogger.info({ event: 'csv_writestream_finish', finalCsvFile: csvFilePath }, 'WriteStream của CSV đã hoàn thành.');
            });


            await streamPipeline(
                rowObjectStream,
                filterLogCollectTransform,
                csvTransform,
                csvWriteStream
            );

            taskLogger.info({
                event: 'csv_stream_collect_success',
                recordsProcessed,
                recordsWrittenToCsv,
                recordsCollected: collectedData.length,
                finalCsvFile: csvFilePath
            }, 'Stream ghi CSV và thu thập dữ liệu hoàn thành thành công.');
            return collectedData;

        } catch (error: any) {
            taskLogger.error({
                err: error,
                recordsProcessed,
                recordsWrittenToCsv,
                recordsCollected: collectedData.length,
                event: 'csv_stream_collect_failed',
                finalCsvFile: csvFilePath
            }, 'Lỗi trong quá trình stream ghi CSV và thu thập dữ liệu');

            // Dọn dẹp các stream
            const destroyStream = (stream: Readable | NodeTransform | fs.WriteStream | null, streamName: string, err?: Error) => {
                if (stream && !stream.destroyed) {
                    stream.destroy(err);
                    taskLogger.info({ event: 'stream_destroyed', streamName, error: !!err }, `Stream ${streamName} đã được hủy.`);
                }
            };

            destroyStream(rowObjectStream, 'rowObjectStream', error instanceof Error ? error : undefined);
            destroyStream(filterLogCollectTransform, 'filterLogCollectTransform', error instanceof Error ? error : undefined);
            destroyStream(csvTransform, 'csvTransform', error instanceof Error ? error : undefined);
            destroyStream(csvWriteStream, 'csvWriteStream', error instanceof Error ? error : new Error(String(error)));

            // Cân nhắc xóa file CSV chưa hoàn chỉnh nếu có lỗi
            if (csvFilePath && fs.existsSync(csvFilePath)) {
                try {
                    // Kiểm tra xem file có dữ liệu không trước khi xóa, hoặc xóa luôn
                    // const stats = await fs.promises.stat(csvFilePath);
                    // if (stats.size === 0) { // Hoặc một tiêu chí khác
                    await fs.promises.unlink(csvFilePath);
                    taskLogger.info({ event: 'incomplete_csv_deleted', file: csvFilePath }, 'Đã xóa file CSV chưa hoàn chỉnh do lỗi.');
                    // }
                } catch (unlinkError) {
                    taskLogger.warn({ err: unlinkError, event: 'incomplete_csv_delete_failed', file: csvFilePath }, 'Không thể xóa file CSV chưa hoàn chỉnh.');
                }
            }

            throw error; // Ném lại lỗi để hàm gọi có thể bắt và xử lý
        }
    }



    public async processOutput(parentLogger?: Logger): Promise<ProcessedRowData[]> {
        const logger = this.getMethodLogger(parentLogger, 'processOutput', {
            finalJsonlPath: this.finalJsonlPath,
            evaluateCsvPath: this.evaluateCsvPath
        });
        logger.info("Processing final output (JSONL to CSV and data collection)...");

        try {
            // Kiểm tra sự tồn tại và kích thước của file JSONL
            if (!fs.existsSync(this.finalJsonlPath)) {
                logger.warn("Final JSONL file not found. No CSV will be generated, returning empty results.");
                return [];
            }
            const stats = await fs.promises.stat(this.finalJsonlPath);
            if (stats.size === 0) {
                logger.warn("Final JSONL file is empty. No CSV will be generated, returning empty results.");
                // Optionally, create an empty CSV with headers
                // await fs.promises.writeFile(this.evaluateCsvPath, this.CSV_FIELDS.map(f => typeof f === 'string' ? f : f.label).join(',') + '\n');
                return [];
            }
        } catch (error: any) {
            // ENOENT đã được xử lý ở trên, đây là các lỗi khác khi stat file
            logger.error({ err: error }, "Error checking final JSONL file stats. Cannot proceed.");
            throw error;
        }

        try {
            const collectedData = await this._writeCSVAndCollectDataInternal(
                this.finalJsonlPath,
                this.evaluateCsvPath,
                logger // Truyền logger của processOutput xuống
            );
            logger.info({ collectedCount: collectedData.length }, 'CSV generation and data collection completed.');
            return collectedData;
        } catch (processingError: any) {
            // Lỗi này đã được log chi tiết bởi _writeCSVAndCollectDataInternal
            logger.error({ err: processingError }, `Final output processing (CSV generation/collection) failed at a higher level. Check previous logs for details.`);
            return []; // Trả về mảng rỗng để báo hiệu thất bại nhưng cho phép chương trình tiếp tục nếu cần
        }
    }
}