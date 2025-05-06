// 2_dom_processing.ts
import { container } from 'tsyringe';
import { JSDOM } from 'jsdom';
import logToFile from '../logger';
import { ConfigService } from "../../config/config.service"; // **IMPORT ConfigService**

// --- Lấy ConfigService Instance ---
const configService = container.resolve(ConfigService); // Resolve singleton instance



// --- Lấy cấu hình từ ConfigService ---
const EXCLUDE_TEXTS = configService.config.EXCLUDE_TEXTS; // Lấy API key
const CFP_TAB_KEYWORDS = configService.config.CFP_TAB_KEYWORDS; // Lấy API key
const IMPORTANT_DATES_TABS = configService.config.IMPORTANT_DATES_TABS; // Lấy API key
const EXACT_KEYWORDS = configService.config.EXACT_KEYWORDS; // Lấy API key

// Log cảnh báo nếu dùng fallback model
if (!configService.config.EXCLUDE_TEXTS || !configService.config.CFP_TAB_KEYWORDS ||
    !configService.config.IMPORTANT_DATES_TABS || !configService.config.EXACT_KEYWORDS) {
    logToFile(`Warning: CRAWL KEYWORDS not set in config".`);
    throw new Error("API Key is not set for GeminiService.");
}

// ======================================
// DOM Cleaning Function - Không thay đổi nhiều
// ======================================
export const cleanDOM = (htmlContent: string): Document | null => {
    try {
        // Tạo JSDOM một lần ở đây là hợp lý vì xử lý cả trang
        const dom = new JSDOM(htmlContent);
        const document: Document = dom.window.document;

        // Loại bỏ script và style tags
        document.querySelectorAll('script, style').forEach(element => {
            try {
                element.remove();
            } catch (removeError: unknown) {
                const errorMessage = removeError instanceof Error ? removeError.message : String(removeError);
                console.error("Error removing script/style:", errorMessage);
            }
        });

        return document;
    } catch (domError: unknown) {
        const errorMessage = domError instanceof Error ? domError.message : String(domError);
        if (domError instanceof Error && domError.stack) {
            console.error(domError.stack);
        }
        console.error("Error creating or cleaning DOM:", errorMessage);
        return null;
    }
};

// ======================================
// Text Normalization Function - Không thay đổi
// ======================================
export const normalizeTextNode = (text: string): string => {
    try {
        let normalizedText: string = text.replace(/([a-zA-Z0-9]),?\n\s*([a-zA-Z0-9])/g, '$1 $2'); // Gộp dòng nếu bị ngắt giữa chữ/số
        normalizedText = normalizedText.replace(/([^\.\?\!])\n\s*/g, '$1 '); // Gộp dòng nếu không phải cuối câu
        normalizedText = normalizedText.replace(/\s+/g, ' '); // Chuẩn hóa khoảng trắng
        return normalizedText.trim();
    } catch (normalizeError: unknown) {
        const errorMessage = normalizeError instanceof Error ? normalizeError.message : String(normalizeError);
        console.error("Error normalizing text:", errorMessage);
        return text; // Trả về text gốc nếu lỗi
    }
};

// ======================================
// Table Processing Function - Tối ưu nối chuỗi
// ======================================
export const processTable = (tableElement: Element, acronym: string | null | undefined, year: number | null | undefined): string => {
    const tableRows: string[] = [];
    try {
        // Thêm khoảng trắng đầu bảng
        tableRows.push(' \n ');

        const rows: NodeListOf<HTMLTableRowElement> = tableElement.querySelectorAll('tr');
        if (rows.length > 0) {
            rows.forEach((row) => {
                const rowParts: string[] = []; // Mảng cho các cell trong một hàng
                try {
                    const cells: NodeListOf<HTMLTableCellElement> = row.querySelectorAll('td, th');
                    cells.forEach((cell) => {
                        try {
                            // Gọi hàm traverseNodes đã tối ưu
                            const cellText: string = traverseNodes(cell, acronym, year).trim();
                            if (cellText) {
                                rowParts.push(cellText); // Thêm text của cell vào mảng parts
                            }
                        } catch (cellTraverseError: unknown) {
                            const errorMessage = cellTraverseError instanceof Error ? cellTraverseError.message : String(cellTraverseError);
                            console.error("Error traversing cell:", errorMessage);
                        }
                    });

                    // Nối các cell text bằng ' | ' nếu hàng có nội dung
                    if (rowParts.length > 0) {
                        tableRows.push(rowParts.join(' | '), ' \n '); // Thêm hàng đã xử lý vào mảng của bảng
                    }
                } catch (rowProcessingError: unknown) {
                    const errorMessage = rowProcessingError instanceof Error ? rowProcessingError.message : String(rowProcessingError);
                    console.error("Error processing row:", errorMessage);
                }
            });
        }
        // Thêm khoảng trắng cuối bảng (đã có '\n' từ hàng cuối)
        // tableRows.push(' \n '); // Có thể không cần nếu mỗi hàng đã có '\n'

    } catch (tableError: unknown) {
        const errorMessage = tableError instanceof Error ? tableError.message : String(tableError);
        console.error("Error processing table:", errorMessage);
    }
    return tableRows.join(''); // Nối tất cả các hàng lại
};


// ======================================
// List Processing Function - Tối ưu nối chuỗi
// ======================================
export const processList = (listElement: Element, acronym: string | null | undefined, year: number | null | undefined): string => {
    const listItems: string[] = [];
    try {
        // Xử lý trực tiếp các thẻ li con trực tiếp nếu có
        listElement.querySelectorAll(':scope > li').forEach(li => { // Chỉ lấy li con trực tiếp
            try {
                // Gọi hàm traverseNodes đã tối ưu
                const liText: string = traverseNodes(li, acronym, year).trim();
                if (liText) {
                    listItems.push(liText, " \n "); // Thêm text của li vào mảng
                }
            } catch (liTraverseError: unknown) {
                const errorMessage = liTraverseError instanceof Error ? liTraverseError.message : String(liTraverseError);
                console.error("Error traversing list item:", errorMessage);
            }
        });

        // Nếu không có thẻ li con trực tiếp (ví dụ: ul > div > li), thử tìm tất cả li bên trong
        // Hoặc giữ nguyên logic cũ là chỉ xử lý nếu không có li nào (hơi lạ, nhưng giữ theo yêu cầu)
        if (listItems.length === 0 && listElement.querySelectorAll('li').length === 0) {
            // Logic cũ: Nếu không có <li> nào bên trong thì mới xử lý như text thường?
            // Đoạn này có thể cần xem lại logic, nhưng tạm thời giữ nguyên ý đồ cũ là duyệt child nodes
            listElement.childNodes.forEach(child => {
                const childText = traverseNodes(child, acronym, year).trim();
                if (childText) {
                    listItems.push(childText, " \n ");
                }
            });
        }

    } catch (listError: unknown) {
        const errorMessage = listError instanceof Error ? listError.message : String(listError);
        console.error("Error processing list:", errorMessage);
    }
    // Thêm khoảng trắng cuối list (đã có '\n' từ item cuối)
    // listItems.push(' \n '); // Có thể không cần

    return listItems.join(''); // Nối các list items
};

// ======================================
// Node Traversal Function - TỐI ƯU HÓA CHÍNH
// ======================================
export const traverseNodes = (node: Node, acronym: string | null | undefined, year: number | null | undefined): string => {
    const textParts: string[] = []; // *** THAY ĐỔI 1: Dùng mảng để nối chuỗi ***
    const yearString = String(year); // Chuyển year sang string một lần
    const normalizedAcronym = (acronym || "").toLowerCase().trim(); // Chuẩn hóa acronym một lần

    try {
        if (node.nodeType === 3) { // Text node (NODE_TEXT)
            if (node.textContent) {
                const trimmedText = normalizeTextNode(node.textContent.trim());
                if (trimmedText) {
                    textParts.push(trimmedText); // Thêm text chuẩn hóa
                    // Quyết định xem có cần thêm khoảng trắng sau text node không
                    // Có thể thêm ở phần xử lý element cha hoặc ở cuối hàm join
                }
            }
        } else if (node.nodeType === 1) { // Element node (NODE_ELEMENT)
            const element = node as Element; // Type assertion an toàn vì đã kiểm tra nodeType
            const tagName = element.tagName.toLowerCase();

            // *** THAY ĐỔI 2: Loại bỏ hoàn toàn việc tạo JSDOM/window bên trong ***

            try {
                // Xử lý các thẻ đặc biệt trước
                if (tagName === 'script' || tagName === 'style' || tagName === 'noscript') {
                    // Bỏ qua hoàn toàn nội dung các thẻ này (đã remove trong cleanDOM nhưng phòng trường hợp còn sót)
                    return '';
                } else if (tagName === 'br') {
                    textParts.push(' \n ');
                } else if (tagName === 'a') {
                    const anchorElement = element as HTMLAnchorElement; // Type assertion
                    const href = anchorElement.getAttribute('href') || "";
                    const lowercaseHref = href.toLowerCase();
                    const linkText = (anchorElement.textContent ?? "").toLowerCase().trim();

                    const isImageLink = lowercaseHref.endsWith('.png') || lowercaseHref.endsWith('.jpeg') || lowercaseHref.endsWith('.jpg');

                    const isExcludedText: boolean = EXCLUDE_TEXTS.some(keyword => linkText.includes(keyword));
                    const normalizedAcronym: string = (acronym || "").toLowerCase().trim();
                    const hasExactKeyword: boolean = EXACT_KEYWORDS.includes(linkText) || EXACT_KEYWORDS.includes(lowercaseHref);
                    const hasAcronymInLink: boolean = linkText.includes(normalizedAcronym) || lowercaseHref.includes(normalizedAcronym) || linkText.includes(String(year) || "") || lowercaseHref.includes(String(year) || "");
                    const hasRelevantKeyword: boolean = CFP_TAB_KEYWORDS.some(keyword => linkText.includes(keyword) || lowercaseHref.includes(keyword)) || IMPORTANT_DATES_TABS.some(keyword => linkText.includes(keyword) || lowercaseHref.includes(keyword));

                    if (!isImageLink && !isExcludedText) {
                        if (hasExactKeyword || hasAcronymInLink || hasRelevantKeyword) {
                            // Lấy text gốc không bị toLowerCase()
                            const originalText = (anchorElement.textContent ?? "").trim();
                            textParts.push(`href="${href}" - ${originalText}\n`);
                        } else {
                            // Nếu link không liên quan, xử lý text bên trong như bình thường
                            element.childNodes.forEach(child => {
                                textParts.push(traverseNodes(child, acronym, year));
                            });
                        }
                    } else {
                        // Link bị loại trừ hoặc là ảnh, vẫn xử lý text bên trong nếu có
                        element.childNodes.forEach(child => {
                            textParts.push(traverseNodes(child, acronym, year));
                        });
                    }
                } else if (tagName === 'option') {
                    const optionElement = element as HTMLOptionElement;
                    const value = optionElement.getAttribute('value') || "";
                    const lowercaseValue = value.toLowerCase();
                    const optionText = (optionElement.textContent ?? "").toLowerCase().trim();


                    const normalizedAcronym: string = (acronym || "").toLowerCase().trim(); // Handle undefined safely
                    const hasExactKeyword: boolean = EXACT_KEYWORDS.includes(optionText) || EXACT_KEYWORDS.includes(lowercaseValue);
                    const hasAcronymInOption: boolean = optionText.includes(normalizedAcronym) || lowercaseValue.includes(normalizedAcronym) || optionText.includes(String(year) || "") || lowercaseValue.includes(String(year) || "");
                    const hasRelevantKeyword: boolean = CFP_TAB_KEYWORDS.some(keyword => optionText.includes(keyword) || lowercaseValue.includes(keyword)) || IMPORTANT_DATES_TABS.some(keyword => optionText.includes(keyword) || lowercaseValue.includes(keyword));
                    const isExcludedText: boolean = EXCLUDE_TEXTS.some(keyword => optionText.includes(keyword));

                    if (!isExcludedText) {
                        if (hasExactKeyword || hasAcronymInOption || hasRelevantKeyword) {
                            const originalText = (optionElement.textContent ?? "").trim();
                            textParts.push(`value="${value}" - ${originalText}\n`);
                        }
                        // Không duyệt con của option
                    }
                } else if (tagName === 'table') {
                    textParts.push(processTable(element, acronym, year));
                }
                // Xử lý LI đặc biệt để join bằng ' | '
                else if (tagName === 'li') {
                    const childrenContent: string[] = [];
                    element.childNodes.forEach(child => {
                        try {
                            const childText = traverseNodes(child, acronym, year).trim(); // Duyệt con
                            if (childText) {
                                childrenContent.push(childText);
                            }
                        } catch (childTraverseError: unknown) {
                            const errorMessage = childTraverseError instanceof Error ? childTraverseError.message : String(childTraverseError);
                            console.error("Error traversing child node (in 'li' tag):", errorMessage);
                        }
                    });
                    if (childrenContent.length > 0) {
                        textParts.push(childrenContent.join(' | '), ' \n '); // Nối các phần con của LI
                    }
                }
                // Xử lý UL/OL tổng quát (gọi processList nếu cần)
                else if (tagName === 'ul' || tagName === 'ol') {
                    // Duyệt các node con bình thường trước
                    element.childNodes.forEach(child => {
                        textParts.push(traverseNodes(child, acronym, year));
                    });
                    // Logic cũ: gọi processList chỉ khi không có thẻ li con nào?
                    const liElements: NodeListOf<HTMLLIElement> = element.querySelectorAll(':scope > li'); // Chỉ con trực tiếp
                    if (liElements.length === 0) {
                        // Logic này hơi lạ, nhưng giữ nguyên: xử lý như list nếu không có li con
                        // textParts.push(processList(element, acronym, year));
                        // Có lẽ không cần gọi processList ở đây nếu đã duyệt con ở trên?
                        // Xem xét lại logic này nếu kết quả không đúng ý.
                    }
                }
                else {
                    // Xử lý các thẻ khác (duyệt con)
                    element.childNodes.forEach(child => {
                        textParts.push(traverseNodes(child, acronym, year));
                    });
                }

                // Thêm khoảng trắng hoặc xuống dòng dựa trên loại thẻ
                const blockLevelTags: string[] = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'blockquote', 'section', 'article', 'header', 'footer', 'aside', 'nav', 'main', 'form', 'fieldset'];
                const isBlock = blockLevelTags.includes(tagName);
                const isListItem = tagName === 'li';
                const isTable = tagName === 'table';

                // Thêm khoảng trắng sau các thẻ inline nếu cần thiết để tách từ
                // (Việc này cần tinh chỉnh tùy theo output mong muốn)
                // Ví dụ: thêm space sau span, strong, em,... nếu node kế tiếp là text hoặc inline khác
                // Hiện tại, việc thêm space sau text node (ở nodeType 3) đã xử lý phần nào việc này.

                // Thêm xuống dòng sau các thẻ block level (trừ khi đã có từ LI, TABLE)
                if (isBlock && !isListItem && !isTable) {
                    // Kiểm tra xem phần tử cuối cùng trong textParts có phải là \n chưa
                    const lastPart = textParts[textParts.length - 1];
                    if (lastPart && !lastPart.endsWith('\n') && !lastPart.endsWith(' \n ')) {
                        textParts.push(' \n ');
                    }
                }


            } catch (tagProcessingError: unknown) {
                const errorMessage = tagProcessingError instanceof Error ? tagProcessingError.message : String(tagProcessingError);
                console.error(`Error processing tag ${tagName}:`, errorMessage);
            }
        } // End nodeType === 1
    } catch (nodeTraversalError: unknown) {
        const errorMessage = nodeTraversalError instanceof Error ? nodeTraversalError.message : String(nodeTraversalError);
        if (nodeTraversalError instanceof Error && nodeTraversalError.stack) {
            console.error(nodeTraversalError.stack);
        }
        console.error("Error traversing node:", errorMessage);
    }
    // Nối tất cả các phần text lại, và chuẩn hóa khoảng trắng/xuống dòng lần cuối
    // Có thể gọi normalizeTextNode hoặc removeExtraEmptyLines ở đây nếu cần
    return textParts.join('');
};

// ======================================
// Remove Extra Empty Lines Function - Không thay đổi
// ======================================
export const removeExtraEmptyLines = (text: string): string => {
    try {
        // Thay thế 3 hoặc nhiều dòng mới liên tiếp bằng đúng 2 dòng mới
        return text.replace(/(\n\s*){3,}/g, '\n\n').trim();
    } catch (replaceError: unknown) {
        const errorMessage = replaceError instanceof Error ? replaceError.message : String(replaceError);
        console.error("Error removing extra empty lines:", errorMessage);
        return text; // Trả về text gốc nếu lỗi
    }
};