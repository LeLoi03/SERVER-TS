// src/utils/dom_processing.ts
import { container } from 'tsyringe';
import { JSDOM } from 'jsdom';
import logToFile from '../logger'; // Updated import path
import { getErrorMessageAndStack } from '../errorUtils'; // Import the error utility
import { ConfigService } from "../../config/config.service";

// Resolve singleton instance of ConfigService
const configService = container.resolve(ConfigService);

// --- Get configuration values from ConfigService ---
// These are essential for the DOM processing logic, especially for link filtering and text extraction.
const EXCLUDE_TEXTS = configService.config.EXCLUDE_TEXTS;
const CFP_TAB_KEYWORDS = configService.config.CFP_TAB_KEYWORDS;
const IMPORTANT_DATES_TABS = configService.config.IMPORTANT_DATES_TABS;
const EXACT_KEYWORDS = configService.config.EXACT_KEYWORDS;

// --- CRITICAL CONFIGURATION CHECK FOR THIS MODULE ---
// Ensure that the necessary keywords for DOM processing are configured.
// These are NOT Gemini API keys, but keywords used in link filtering.
if (!EXCLUDE_TEXTS || !CFP_TAB_KEYWORDS || !IMPORTANT_DATES_TABS || !EXACT_KEYWORDS) {
    const errorMessage = "Critical configuration missing for DOM processing: EXCLUDE_TEXTS, CFP_TAB_KEYWORDS, IMPORTANT_DATES_TABS, or EXACT_KEYWORDS are not set.";
    logToFile(`[FATAL ERROR] [DOM Processing] ${errorMessage}`);
    throw new Error(errorMessage);
}


// ======================================
// DOM Cleaning Function
// ======================================
/**
 * Cleans the provided HTML content by removing script and style tags.
 * This prepares the DOM for text extraction.
 * @param {string} htmlContent - The raw HTML string.
 * @returns {Document | null} The cleaned JSDOM Document object, or null if an error occurs.
 */
export const cleanDOM = (htmlContent: string): Document | null => {
    try {
        const dom = new JSDOM(htmlContent);
        const document: Document = dom.window.document;

        // Remove script and style tags from the document.
        document.querySelectorAll('script, style').forEach(element => {
            try {
                element.remove();
            } catch (removeError: unknown) {
                const { message: errorMessage } = getErrorMessageAndStack(removeError);
                logToFile(`[ERROR] [DOM Processing] Error removing script/style tag: ${errorMessage}.`);
            }
        });

        return document;
    } catch (domError: unknown) {
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(domError);
        logToFile(`[ERROR] [DOM Processing] Error creating or cleaning DOM: ${errorMessage}. Stack: ${errorStack}.`);
        return null;
    }
};

// ======================================
// Text Normalization Function
// ======================================
/**
 * Normalizes a given text string by:
 * - Merging lines broken between alphanumeric characters.
 * - Merging lines not ending with punctuation.
 * - Standardizing multiple spaces into single spaces.
 * @param {string} text - The input text string.
 * @returns {string} The normalized text string. Returns original text if an error occurs during normalization.
 */
export const normalizeTextNode = (text: string): string => {
    try {
        let normalizedText: string = text.replace(/([a-zA-Z0-9]),?\n\s*([a-zA-Z0-9])/g, '$1 $2');
        normalizedText = normalizedText.replace(/([^\.\?\!])\n\s*/g, '$1 ');
        normalizedText = normalizedText.replace(/\s+/g, ' ');
        return normalizedText.trim();
    } catch (normalizeError: unknown) {
        const { message: errorMessage } = getErrorMessageAndStack(normalizeError);
        logToFile(`[ERROR] [DOM Processing] Error normalizing text: ${errorMessage}. Returning original text.`);
        return text;
    }
};

// ======================================
// Table Processing Function
// ======================================
/**
 * Processes a table HTML element, extracting its content row by row, cell by cell.
 * Each row's cells are joined by ' | ', and rows are separated by newlines.
 * @param {Element} tableElement - The table HTML element.
 * @param {string | null | undefined} acronym - The conference acronym for context-aware processing.
 * @param {number | null | undefined} year - The conference year for context-aware processing.
 * @returns {string} The extracted and formatted text content of the table.
 */
export const processTable = (tableElement: Element, acronym: string | null | undefined, year: number | null | undefined): string => {
    const tableRows: string[] = [];
    try {
        tableRows.push(' \n '); // Add a leading newline for separation

        const rows: NodeListOf<HTMLTableRowElement> = tableElement.querySelectorAll('tr');
        if (rows.length > 0) {
            rows.forEach((row) => {
                const rowParts: string[] = [];
                try {
                    const cells: NodeListOf<HTMLTableCellElement> = row.querySelectorAll('td, th');
                    cells.forEach((cell) => {
                        try {
                            const cellText: string = traverseNodes(cell, acronym, year).trim();
                            if (cellText) {
                                rowParts.push(cellText);
                            }
                        } catch (cellTraverseError: unknown) {
                            const { message: errorMessage } = getErrorMessageAndStack(cellTraverseError);
                            logToFile(`[ERROR] [DOM Processing] Error traversing cell within table: ${errorMessage}.`);
                        }
                    });

                    if (rowParts.length > 0) {
                        tableRows.push(rowParts.join(' | '));
                    }
                } catch (rowProcessingError: unknown) {
                    const { message: errorMessage } = getErrorMessageAndStack(rowProcessingError);
                    logToFile(`[ERROR] [DOM Processing] Error processing table row: ${errorMessage}.`);
                }
            });
        }
        tableRows.push(' \n '); // Add a trailing newline for separation

    } catch (tableError: unknown) {
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(tableError);
        logToFile(`[ERROR] [DOM Processing] Error processing table: ${errorMessage}. Stack: ${errorStack}.`);
    }
    return tableRows.join('\n'); // Join rows with a newline character
};


// ======================================
// List Processing Function
// ======================================
/**
 * Processes a list HTML element (UL or OL), extracting its content item by item.
 * Each list item is processed, and a newline is added after each.
 * This function prioritizes direct `li` children.
 * @param {Element} listElement - The list HTML element (UL or OL).
 * @param {string | null | undefined} acronym - The conference acronym.
 * @param {number | null | undefined} year - The conference year.
 * @returns {string} The extracted and formatted text content of the list.
 */
export const processList = (listElement: Element, acronym: string | null | undefined, year: number | null | undefined): string => {
    const listItems: string[] = [];
    try {
        // Find direct child <li> elements
        const directLiChildren = listElement.querySelectorAll(':scope > li');

        if (directLiChildren.length > 0) {
            directLiChildren.forEach(li => {
                try {
                    // Traverse content of each direct <li>
                    const liText: string = traverseNodes(li, acronym, year).trim();
                    if (liText) {
                        listItems.push(liText);
                    }
                } catch (liTraverseError: unknown) {
                    const { message: errorMessage } = getErrorMessageAndStack(liTraverseError);
                    logToFile(`[ERROR] [DOM Processing] Error traversing list item (direct child): ${errorMessage}.`);
                }
            });
        } else {
            // If no direct <li> children, traverse all child nodes as generic text
            // This handles cases where list items might be wrapped in other tags (e.g., UL > DIV > LI)
            // or if the list contains non-<li> direct children that should be treated as text.
            listElement.childNodes.forEach(child => {
                try {
                    const childText = traverseNodes(child, acronym, year).trim();
                    if (childText) {
                        listItems.push(childText);
                    }
                } catch (childTraverseError: unknown) {
                    const { message: errorMessage } = getErrorMessageAndStack(childTraverseError);
                    logToFile(`[ERROR] [DOM Processing] Error traversing child node within list (no direct li): ${errorMessage}.`);
                }
            });
        }

    } catch (listError: unknown) {
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(listError);
        logToFile(`[ERROR] [DOM Processing] Error processing list: ${errorMessage}. Stack: ${errorStack}.`);
    }
    return listItems.join('\n'); // Join list items with a newline
};

// ======================================
// Node Traversal Function - CORE OPTIMIZATION
// ======================================
/**
 * Recursively traverses a DOM node to extract its text content,
 * handling specific HTML elements and applying content filtering/formatting.
 * This is the core function for extracting relevant text from a parsed HTML document.
 *
 * @param {Node} node - The DOM node to traverse (can be Element or TextNode).
 * @param {string | null | undefined} acronym - The conference acronym for context-aware link filtering.
 * @param {number | null | undefined} year - The conference year for context-aware link filtering.
 * @returns {string} The extracted and formatted text content of the node and its children.
 */
export const traverseNodes = (node: Node, acronym: string | null | undefined, year: number | null | undefined): string => {
    const textParts: string[] = [];
    const yearString = String(year);
    const normalizedAcronym = (acronym || "").toLowerCase().trim();

    try {
        if (node.nodeType === 3) { // Text node (Node.TEXT_NODE)
            if (node.textContent) {
                const trimmedText = normalizeTextNode(node.textContent); // normalizeTextNode already trims
                if (trimmedText) {
                    textParts.push(trimmedText);
                }
            }
        } else if (node.nodeType === 1) { // Element node (Node.ELEMENT_NODE)
            const element = node as Element;
            const tagName = element.tagName.toLowerCase();

            switch (tagName) {
                case 'script':
                case 'style':
                case 'noscript':
                    // Ignore content of these tags
                    return '';
                case 'br':
                    textParts.push('\n'); // Line break
                    break;
                case 'a':
                    const anchorElement = element as HTMLAnchorElement;
                    const href = anchorElement.getAttribute('href') || "";
                    const lowercaseHref = href.toLowerCase();
                    const linkText = (anchorElement.textContent ?? "").toLowerCase().trim();

                    const isImageLink = lowercaseHref.endsWith('.png') || lowercaseHref.endsWith('.jpeg') || lowercaseHref.endsWith('.jpg') || lowercaseHref.endsWith('.gif');
                    const isExcludedText = EXCLUDE_TEXTS.some(keyword => linkText.includes(keyword));
                    const hasExactKeyword = EXACT_KEYWORDS.includes(linkText) || EXACT_KEYWORDS.includes(lowercaseHref);
                    const hasAcronymInLink = linkText.includes(normalizedAcronym) || lowercaseHref.includes(normalizedAcronym) || linkText.includes(yearString) || lowercaseHref.includes(yearString);
                    const hasRelevantKeyword = CFP_TAB_KEYWORDS.some(keyword => linkText.includes(keyword) || lowercaseHref.includes(keyword)) || IMPORTANT_DATES_TABS.some(keyword => linkText.includes(keyword) || lowercaseHref.includes(keyword));

                    if (!isImageLink && !isExcludedText && (hasExactKeyword || hasAcronymInLink || hasRelevantKeyword)) {
                        const originalText = (anchorElement.textContent ?? "").trim();
                        textParts.push(`href="${href}" - ${originalText}`);
                    } else {
                        // If not a relevant link, traverse its children as normal text
                        element.childNodes.forEach(child => {
                            textParts.push(traverseNodes(child, acronym, year));
                        });
                    }
                    break;
                case 'option':
                    const optionElement = element as HTMLOptionElement;
                    const value = optionElement.getAttribute('value') || "";
                    const lowercaseValue = value.toLowerCase();
                    const optionText = (optionElement.textContent ?? "").toLowerCase().trim();

                    const isExcludedOption = EXCLUDE_TEXTS.some(keyword => optionText.includes(keyword));
                    const hasExactOptionKeyword = EXACT_KEYWORDS.includes(optionText) || EXACT_KEYWORDS.includes(lowercaseValue);
                    const hasAcronymInOption = optionText.includes(normalizedAcronym) || lowercaseValue.includes(normalizedAcronym) || optionText.includes(yearString) || lowercaseValue.includes(yearString);
                    const hasRelevantOptionKeyword = CFP_TAB_KEYWORDS.some(keyword => optionText.includes(keyword) || lowercaseValue.includes(keyword)) || IMPORTANT_DATES_TABS.some(keyword => optionText.includes(keyword) || lowercaseValue.includes(keyword));

                    if (!isExcludedOption && (hasExactOptionKeyword || hasAcronymInOption || hasRelevantOptionKeyword)) {
                        const originalText = (optionElement.textContent ?? "").trim();
                        textParts.push(`value="${value}" - ${originalText}`);
                    }
                    // Do not traverse children of <option> as text content is typically directly within it.
                    break;
                case 'table':
                    textParts.push(processTable(element, acronym, year));
                    break;
                case 'li':
                    // For <li>, we process its children and join them with ' | ' if appropriate.
                    // This is usually handled by `processList` if `li` is a direct child of `ul`/`ol`.
                    // If `traverseNodes` is called directly on `li` (e.g., from `processTable`),
                    // we still want to get its content.
                    const liContentParts: string[] = [];
                    element.childNodes.forEach(child => {
                        liContentParts.push(traverseNodes(child, acronym, year));
                    });
                    const liText = liContentParts.join('').trim();
                    if (liText) {
                        textParts.push(liText); // Just push its content, `processList` will handle ` | ` and `\n`
                    }
                    break;
                case 'ul':
                case 'ol':
                    // If it's a list, delegate to processList to handle <li> elements correctly.
                    textParts.push(processList(element, acronym, year));
                    break;
                case 'img':
                    // Optional: You might want to extract alt text or src if it's relevant,
                    // but for general text extraction, we often ignore images.
                    const altText = element.getAttribute('alt');
                    if (altText) {
                        textParts.push(altText.trim());
                    }
                    break;
                default:
                    // For all other elements, recursively traverse their children.
                    element.childNodes.forEach(child => {
                        textParts.push(traverseNodes(child, acronym, year));
                    });
                    break;
            }

            // Add newlines after block-level elements for better readability.
            const blockLevelTags: string[] = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'blockquote', 'section', 'article', 'header', 'footer', 'aside', 'nav', 'main', 'form', 'fieldset', 'address', 'pre', 'hr', 'figure', 'figcaption', 'details', 'summary'];
            if (blockLevelTags.includes(tagName)) {
                // Ensure there's at least one newline after a block element.
                // We don't want to add multiple extra newlines if content already ends with one.
                const lastPart = textParts[textParts.length - 1];
                if (lastPart && !lastPart.endsWith('\n')) { // Check if last part doesn't end with a newline
                    textParts.push('\n');
                } else if (!lastPart && textParts.length > 0) { // If lastPart is empty string but there are parts
                    // This handles cases where an empty block tag is pushed, then needs a newline.
                    textParts.push('\n');
                }
            } else if (tagName === 'br') {
                // `br` already pushes a '\n', no need for more.
            } else if (tagName === 'table' || tagName === 'ul' || tagName === 'ol') {
                // `processTable` and `processList` already handle internal newlines and potentially trailing newlines.
                // Ensure we don't add redundant newlines if they already emit them.
                const lastPart = textParts[textParts.length - 1];
                if (lastPart && !lastPart.endsWith('\n')) {
                    textParts.push('\n');
                }
            }
        }
    } catch (nodeTraversalError: unknown) {
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(nodeTraversalError);
        logToFile(`[ERROR] [DOM Processing] Error traversing node: ${errorMessage}. Stack: ${errorStack}.`);
    }

    // Join all extracted text parts.
    // The `removeExtraEmptyLines` will handle excessive newlines at the very end.
    return textParts.join('');
};

// ======================================
// Remove Extra Empty Lines Function
// ======================================
/**
 * Removes excessive empty lines from a text string, consolidating three or more consecutive newlines
 * into exactly two newlines, and trims the final string.
 * @param {string} text - The input text string.
 * @returns {string} The text string with extra empty lines removed. Returns original text if an error occurs.
 */
export const removeExtraEmptyLines = (text: string): string => {
    try {
        // Replace three or more consecutive newlines (possibly with whitespace in between)
        // with exactly two newlines.
        return text.replace(/(\n\s*){3,}/g, '\n\n').trim();
    } catch (replaceError: unknown) {
        const { message: errorMessage } = getErrorMessageAndStack(replaceError);
        logToFile(`[ERROR] [DOM Processing] Error removing extra empty lines: ${errorMessage}. Returning original text.`);
        return text;
    }
};