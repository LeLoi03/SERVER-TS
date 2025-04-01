// src/utils/dom_processing.ts
import { JSDOM } from 'jsdom';
import { EXCLUDE_TEXTS, CFP_TAB_KEYWORDS, IMPORTANT_DATES_TABS, EXACT_KEYWORDS } from '../config'; // Import from config.ts

// DOM Cleaning Function
export const cleanDOM = (htmlContent: string): Document | null => {
    try {
        const dom = new JSDOM(htmlContent);
        const document: Document = dom.window.document;
        const scripts: NodeListOf<HTMLScriptElement> = document.querySelectorAll('script');
        scripts.forEach(script => {
            try {
                script.remove();
            } catch (removeError: unknown) {
                const errorMessage = removeError instanceof Error ? removeError.message : String(removeError);
                console.error("Error removing script:", errorMessage);
            }
        });
        const styles: NodeListOf<HTMLStyleElement> = document.querySelectorAll('style');
        styles.forEach(style => {
            try {
                style.remove();
            } catch (removeError: unknown) {
                const errorMessage = removeError instanceof Error ? removeError.message : String(removeError);
                console.error("Error removing style:", errorMessage);
            }
        });
        return document;
    } catch (domError: unknown) {
        const errorMessage = domError instanceof Error ? domError.message : String(domError);
        if (domError instanceof Error && domError.stack) {
            console.error(domError.stack);
        }
        console.error("Error creating or cleaning DOM:", errorMessage);
        return null; // Or a minimal DOM, or a string, as appropriate.
    }
};

// Text Normalization Function
export const normalizeTextNode = (text: string): string => {
    try {
        let normalizedText: string = text.replace(/([a-zA-Z0-9]),?\n\s*([a-zA-Z0-9])/g, '$1 $2');
        normalizedText = normalizedText.replace(/([^\.\?\!])\n\s*/g, '$1 ');
        normalizedText = normalizedText.replace(/\s+/g, ' ');
        return normalizedText.trim();
    } catch (normalizeError: unknown) {
        const errorMessage = normalizeError instanceof Error ? normalizeError.message : String(normalizeError);
        console.error("Error normalizing text:", errorMessage);
        return text; // Return the original text if normalization fails
    }
};

// Table Processing Function
export const processTable = (table: ParentNode, acronym: string | null | undefined, year: number | null | undefined): string => {
    let tableText: string = '';
    try {
        const rows: NodeListOf<HTMLTableRowElement> = table.querySelectorAll('tr');
        if (rows.length === 0) return tableText;

        rows.forEach((row, rowIndex) => {
            try {
                const cells: NodeListOf<HTMLTableCellElement> = row.querySelectorAll('td, th');
                if (rowIndex === 0) {
                    tableText += ' \n ';
                }
                let rowText: string = '';
                cells.forEach((cell, index) => {
                    try {
                        const cellText: string = traverseNodes(cell, acronym, year).trim();
                        if (cellText) {
                            rowText += (index === cells.length - 1) ? cellText : cellText + ' | ';
                        }
                    } catch (cellTraverseError: unknown) {
                        const errorMessage = cellTraverseError instanceof Error ? cellTraverseError.message : String(cellTraverseError);
                        console.error("Error traversing cell:", errorMessage);
                        //  Decide: Add a placeholder?  Skip this cell?
                    }
                });
                if (rowText.trim()) {
                    tableText += rowText + ' \n ';
                }
            } catch (rowProcessingError: unknown) {
                const errorMessage = rowProcessingError instanceof Error ? rowProcessingError.message : String(rowProcessingError);
                console.error("Error processing row:", errorMessage);
                // Decide what to do: skip entire row?, add placeholder row?
            }

        });
    } catch (tableError: unknown) {
        const errorMessage = tableError instanceof Error ? tableError.message : String(tableError);
        console.error("Error processing table:", errorMessage);
        // Decide:  Return empty string?  Return partial tableText?
    }
    return tableText + ' \n ';
};

// List Processing Function
export const processList = (list: ParentNode, acronym: string | null | undefined, year: number | null | undefined): string => {
    let listText: string = '';
    try {
        list.querySelectorAll('li').forEach(li => {
            try {
                const liText: string = traverseNodes(li, acronym, year).trim();
                if (liText) {
                    listText += liText + " \n ";
                }
            } catch (liTraverseError: unknown) {
                const errorMessage = liTraverseError instanceof Error ? liTraverseError.message : String(liTraverseError);
                console.error("Error traversing list item:", errorMessage);
                // Decide: Add placeholder? Skip this list item?
            }
        });

    } catch (listError: unknown) {
        const errorMessage = listError instanceof Error ? listError.message : String(listError);
        console.error("Error processing list:", errorMessage);
        // Decide: Return empty string?  Return partial listText?
    }
    return listText + ' \n ';
};

// Node Traversal Function
export const traverseNodes = (node: Node, acronym: string | null | undefined, year: number | null | undefined): string => {
    let text: string = '';
    const yearString = String(year);
    try {
        if (node.nodeType === 3) { // Text node
            if (node.textContent) {
                const trimmedText: string = normalizeTextNode(node.textContent.trim());
                if (trimmedText) {
                    text += trimmedText + ' ';
                }
            }
        } else if (node.nodeType === 1) { // Element node
            const element = node as Element; // Type assertion to Element
            const tagName: string = element.tagName.toLowerCase();
            try {
                if (tagName === 'a' && element instanceof HTMLAnchorElement) {
                    const href: string | null = element.getAttribute('href');
                    const lowercaseHref: string = (href || "").toLowerCase();
                    // Use optional chaining and nullish coalescing operator here
                    const linkText: string = (element.textContent ?? "").toLowerCase().trim();
                    const isImageLink: boolean = lowercaseHref.endsWith('.png') || lowercaseHref.endsWith('.jpeg') || lowercaseHref.endsWith('.jpg');
                    const isExcludedText: boolean = EXCLUDE_TEXTS.some(keyword => linkText.includes(keyword));
                    const normalizedAcronym: string = (acronym || "").toLowerCase().trim(); // Handle undefined safely
                    const hasExactKeyword: boolean = EXACT_KEYWORDS.includes(linkText) || EXACT_KEYWORDS.includes(lowercaseHref);
                    const hasAcronymInLink: boolean = linkText.includes(normalizedAcronym) || lowercaseHref.includes(normalizedAcronym) || linkText.includes(String(year) || "") || lowercaseHref.includes(String(year) || "");
                    const hasRelevantKeyword: boolean = CFP_TAB_KEYWORDS.some(keyword => linkText.includes(keyword) || lowercaseHref.includes(keyword)) || IMPORTANT_DATES_TABS.some(keyword => linkText.includes(keyword) || lowercaseHref.includes(keyword));

                    if (!isImageLink && !isExcludedText) {
                        if (hasExactKeyword || hasAcronymInLink || hasRelevantKeyword) {
                            text += `href="${href}" - ${element.textContent?.trim() ?? ''}\n`; // Use optional chaining here too, and nullish coalescing
                        } else {
                            // Recursively process child nodes if no relevant keywords found
                            element.childNodes.forEach(child => {
                                try {
                                    text += traverseNodes(child, acronym, year);
                                } catch (childTraverseError: unknown) {
                                    const errorMessage = childTraverseError instanceof Error ? childTraverseError.message : String(childTraverseError);
                                    console.error("Error traversing child node (in 'a' tag):", errorMessage);
                                }
                            });
                        }
                    } else {
                        // Recursively process child nodes for image links and excluded text
                        element.childNodes.forEach(child => {
                            try {
                                text += traverseNodes(child, acronym, year);
                            } catch (childTraverseError: unknown) {
                                const errorMessage = childTraverseError instanceof Error ? childTraverseError.message : String(childTraverseError);
                                console.error("Error traversing child node (in excluded 'a' tag):", errorMessage);
                            }
                        });
                    }
                } else if (tagName === 'option' && element instanceof HTMLOptionElement) {
                    const value: string | null = element.getAttribute('value');
                    const lowercaseValue: string = (value || "").toLowerCase();
                    // Use optional chaining and nullish coalescing operator here
                    const optionText: string = (element.textContent ?? "").toLowerCase().trim();

                    const normalizedAcronym: string = (acronym || "").toLowerCase().trim(); // Handle undefined safely
                    const hasExactKeyword: boolean = EXACT_KEYWORDS.includes(optionText) || EXACT_KEYWORDS.includes(lowercaseValue);
                    const hasAcronymInOption: boolean = optionText.includes(normalizedAcronym) || lowercaseValue.includes(normalizedAcronym) || optionText.includes(String(year) || "") || lowercaseValue.includes(String(year) || "");
                    const hasRelevantKeyword: boolean = CFP_TAB_KEYWORDS.some(keyword => optionText.includes(keyword) || lowercaseValue.includes(keyword)) || IMPORTANT_DATES_TABS.some(keyword => optionText.includes(keyword) || lowercaseValue.includes(keyword));
                    const isExcludedText: boolean = EXCLUDE_TEXTS.some(keyword => optionText.includes(keyword));

                    if (!isExcludedText) { // Assuming you want to exclude certain texts
                        if (hasExactKeyword || hasAcronymInOption || hasRelevantKeyword) {
                            text += `value="${value}" - ${element.textContent?.trim() ?? ''}\n`; // Use optional chaining here too, and nullish coalescing
                        }
                        // No recursive processing for child nodes, as <option> tags typically don't have meaningful child nodes.  Adjust if needed.
                    }
                } else if (tagName === 'table' && element instanceof HTMLTableElement) {
                    text += processTable(element, acronym, year); // Pass acronym and year
                } else if (tagName === 'li' && element instanceof HTMLLIElement) {
                    const childrenText: string[] = [];
                    element.childNodes.forEach(child => {
                        try {
                            const childText: string = traverseNodes(child, acronym, year).trim();
                            if (childText) {
                                childrenText.push(childText);
                            }
                        } catch (childTraverseError: unknown) {
                            const errorMessage = childTraverseError instanceof Error ? childTraverseError.message : String(childTraverseError);
                            console.error("Error traversing child node (in 'li' tag):", errorMessage);
                        }
                    });
                    if (childrenText.length > 0) {
                        text += childrenText.join(' | ') + ' \n ';
                    }
                } else if (tagName === 'br') {
                    text += ' \n ';
                } else {
                    // Generic handling for other tags (recursively process children)
                    element.childNodes.forEach(child => {
                        try {
                            text += traverseNodes(child, acronym, year);
                        } catch (childTraverseError: unknown) {
                            const errorMessage = childTraverseError instanceof Error ? childTraverseError.message : String(childTraverseError);
                            console.error("Error traversing child node (in generic tag):", errorMessage);
                        }
                    });
                    if ((tagName === 'ul' || tagName === 'ol') && element instanceof HTMLUListElement || element instanceof HTMLOListElement) {
                        const liElements: NodeListOf<HTMLLIElement> = element.querySelectorAll('li');
                        if (liElements.length === 0) {
                            text += processList(element, acronym, year); //pass acronym and year
                        }
                    }
                }
                const blockLevelTags: string[] = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'section', 'article', 'header', 'footer', 'aside', 'nav', 'main'];
                if (!blockLevelTags.includes(tagName) && tagName !== 'table' && tagName !== 'ul' && tagName !== 'ol' && tagName !== 'a') {
                    text += ' ';
                }
                if (blockLevelTags.includes(tagName) || (tagName === 'div' && element.closest('li') === null)) {
                    text += ' \n ';
                }

            } catch (tagProcessingError: unknown) {
                const errorMessage = tagProcessingError instanceof Error ? tagProcessingError.message : String(tagProcessingError);
                console.error(`Error processing tag ${tagName}:`, errorMessage);
                // Decide: Add placeholder? Skip this tag and its children?
            }

        } // End of nodeType === 1 (Element node)
    } catch (nodeTraversalError: unknown) {
        const errorMessage = nodeTraversalError instanceof Error ? nodeTraversalError.message : String(nodeTraversalError);
        if (nodeTraversalError instanceof Error && nodeTraversalError.stack) {
            console.error(nodeTraversalError.stack);
        }
        console.error("Error traversing node:", errorMessage);
        // Decide: Return empty string?  Return partial text?
    }
    return text;
};

// Remove Extra Empty Lines Function
export const removeExtraEmptyLines = (text: string): string => {
    try {
        return text.replace(/\n\s*\n\s*\n/g, '\n\n');
    } catch (replaceError: unknown) {
        const errorMessage = replaceError instanceof Error ? replaceError.message : String(replaceError);
        console.error("Error removing extra empty lines:", errorMessage);
        return text; // Return original text if replacement fails.
    }
};