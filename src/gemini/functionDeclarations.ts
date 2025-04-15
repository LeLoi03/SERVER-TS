import {
    FunctionDeclaration,
    SchemaType,
} from "@google/generative-ai";

export const getConferencesDeclaration: FunctionDeclaration = {
    name: "getConferences",
    // Mô tả rõ mục đích là tạo query string
    description: "Generates a URL-encoded query string to search for conferences based on user-specified criteria. This query string will be used to fetch data from the backend API." +
        " It is crucial that *all* values in the query string are properly URL-encoded to ensure the backend API correctly interprets the search criteria. Failure to properly encode values can lead to incorrect search results or errors." +
        " Be mindful of the maximum length of a URL, as excessively long query strings may be truncated by browsers or servers. Consider limiting the number of `topics` or `researchFields` parameters if necessary." +
        " The backend API may be case-sensitive for certain parameters (e.g., `country`, `continent`). Ensure the casing of the values matches the expected format." +
        " A comprehensive example combining multiple criteria: `title=International%20Conference%20on%20AI&topics=AI&topics=Machine%20Learning&country=USA&fromDate=2024-01-01&toDate=2024-12-31&rank=A*`",
    parameters: {
        type: SchemaType.OBJECT, // Vẫn là OBJECT theo cấu trúc chung
        properties: {
            // Định nghĩa một tham số duy nhất để chứa query string
            searchQuery: {
                type: SchemaType.STRING,
                // Hướng dẫn chi tiết cách tạo query string
                description: "A URL-encoded query string constructed from the user's search criteria for conferences. Format as key=value pairs separated by '&'. " +
                    "Available keys based on potential user queries include: " +
                    "`title` (string):  The full, formal name of the conference.(e.g., International Conference on Management of Digital EcoSystems) " +
                    "`acronym` (string): The abbreviated name of the conference, often represented by capital letters (e.g., ICCCI, SIGGRAPH, ABZ). " +
                    "`fromDate` (string, e.g., YYYY-MM-DD), " +
                    "`toDate` (string, e.g., YYYY-MM-DD), " +
                    "`topics` (string, repeat key for multiple values, e.g., topics=AI&topics=ML), " +
                    "`cityStateProvince` (string), " +
                    "`country` (string), " +
                    "`continent` (string), " +
                    "`address` (string), " +
                    "`researchFields` (string, repeat key for multiple values), " +
                    "`rank` (string), " +
                    "`source` (string), " +
                    "`accessType` (string), " +
                    "`keyword` (string), " +
                    "`subFromDate` (string), `subToDate` (string), " +
                    "`cameraReadyFromDate` (string), `cameraReadyToDate` (string), " +
                    "`notificationFromDate` (string), `notificationToDate` (string), " +
                    "`registrationFromDate` (string), `registrationToDate` (string), " +
                    "`mode` (string): If the user requests detailed information, the value is always `detail`. " +
                    "`perPage` (number):  The number of conferences to return per page. If the user specifies a number, use that value. If the user doesn't specify a number, default to 5." +
                    "`page` (number):  The page number of the results to return. If the user wants to see the next set of conferences, use page=2, page=3, etc. If the user doesn't specify a page number, default to 1." +
                    "Ensure all values are properly URL-encoded (e.g., spaces become %20 or +). " +

                    "**Distinguishing between Title and Acronym:** It is crucial to correctly identify whether the user is providing the full conference title or the acronym.  Here's how to differentiate them:" +
                    "* **Title:** This is the complete, unabbreviated name of the conference.  It is typically a phrase or sentence that describes the conference's focus. Example: 'International Conference on Machine Learning'.  Use the `title` parameter for this." +
                    "* **Acronym:** This is a short, usually capitalized, abbreviation of the conference name. Example: 'ICML' (for International Conference on Machine Learning).  Use the `acronym` parameter for this." +

                    "**Examples:**" +
                    "* User query: 'Find conferences about ICML'.  `searchQuery=acronym=ICML&perPage=5&page=1` (Default perPage and page)" +
                    "* User query: 'Search for the International Conference on Management of Digital EcoSystems'. `searchQuery=title=International%20Conference%20on%20Management%20of%20Digital%20EcoSystems&perPage=5&page=1` (Default perPage and page)" +
                    "* User query: 'Find MEDES conferences'. `searchQuery=acronym=MEDES&perPage=5&page=1` (Default perPage and page)" +
                    "* User query: 'Search for conferences with the full name International Conference on Recent Trends in Image Processing, Pattern Recognition and Machine Learning'. `searchQuery=title=International%20Conference%20on%20Recent%20Trends%20in%20Image%20Processing,%20Pattern%20Recognition%20and%20Machine%20Learning&perPage=5&page=1` (Default perPage and page)" +
                    "* User query 1: 'Find 3 conferences in USA'. `searchQuery=country=USA&perPage=3&page=1` User query 2: 'Find 5 different conferences in USA'. `searchQuery=country=USA&perPage=5&page=2`" +

                    "For example, if a topic contains both spaces and special characters, like 'Data Science & Analysis', it should be encoded as 'Data%20Science%20%26%20Analysis'. " +
                    "If a user doesn't specify a value for a particular key, it should be omitted entirely from the query string.  Do not include keys with empty values (e.g., `title=`). " +
                    "To specify multiple topics or research fields, repeat the key for each value. For example: `topics=AI&topics=Machine%20Learning&researchFields=Computer%20Vision&researchFields=Natural%20Language%20Processing`. " +
                    "Always URL-encode special characters in values. For example, use `%20` for spaces, `%26` for ampersands (&), `%3D` for equals signs (=), and `%2B` for plus signs (+). " +
                    "To search for conferences between two dates, use `fromDate` and `toDate`. For example, to search for conferences happening between January 1, 2023, and December 31, 2023, use `fromDate=2023-01-01&toDate=2023-12-31`. " +
                    "If the user requests *detailed* information about the conferences (e.g., full descriptions, specific dates, call for papers, summary, etc.), include the parameter `mode=detail` in the query string. Otherwise, if the user does not specify, return the summary"
            }
        },
        // Đảm bảo Gemini luôn cung cấp tham số này
        required: ["searchQuery"]
    }
};



export const getJournalsDeclaration: FunctionDeclaration = {
    name: "getJournals",
    description: "Retrieves information about journals based on filtering criteria.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            "Rank": {
                "type": SchemaType.ARRAY,
                "description": "List of journal ranks to filter by.",
                "items": {
                    "type": SchemaType.NUMBER
                }
            },
            "Title": {
                "type": SchemaType.ARRAY,
                "description": "List of journal titles to filter by.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Issn": {
                "type": SchemaType.ARRAY,
                "description": "List of journal ISSNs to filter by.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "SJR": {
                "type": SchemaType.ARRAY,
                "description": "List of journal SJR values to filter by.",
                "items": {
                    "type": SchemaType.NUMBER
                }
            },
            "SJRBestQuartile": {
                "type": SchemaType.ARRAY,
                "description": "List of journal SJR Best Quartile values to filter by.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "HIndex": {
                "type": SchemaType.INTEGER,
                "description": "Journal H index to filter by."
            },
            "Country": {
                "type": SchemaType.ARRAY,
                "description": "List of countries to filter journals by.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Region": {
                "type": SchemaType.ARRAY,
                "description": "List of regions to filter journals by.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Publisher": {
                "type": SchemaType.ARRAY,
                "description": "List of publishers to filter journals by.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Areas": {
                "type": SchemaType.ARRAY,
                "description": "List of areas to filter journals by.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Categories": {
                "type": SchemaType.ARRAY,
                "description": "List of categories to filter journals by.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Overton": {
                "type": SchemaType.ARRAY,
                "description": "List of Overton values to filter journals by.",
                "items": {
                    "type": SchemaType.NUMBER
                }
            },
            "SDG": {
                "type": SchemaType.ARRAY,
                "description": "List of SDGs to filter journals by.",
                "items": {
                    "type": SchemaType.STRING
                }
            }
        }
    },
};

export const getWebsiteInformationDeclaration: FunctionDeclaration = {
    name: "getWebsiteInformation",
    description: "Retrieves information about websites."
};

export const drawChartDeclaration: FunctionDeclaration = {
    name: "drawChart",
    description: "Draws a chart based on the provided data.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            chartType: {
                type: SchemaType.STRING,
                description: "The type of chart (e.g., bar, line, pie).",
            }
        },
        required: ["chartType"],
    },
};

export const systemInstructions = `
  ### ROLE ###
  You are HCMUS, a friendly and helpful chatbot specializing in conference information and the Global Conference & Journal Hub (GCJH) website. You will act as a helpful assistant that can filter information about conferences, journals and website information.
  
  ### INSTRUCTIONS ###
  1.  **ONLY use information returned by the provided functions ('getConferences', 'getJournals', 'getWebsiteInformation', or 'drawChart') to answer user requests.** Do not invent information or use outside knowledge. You will answer user queries based solely on provided data sources: a database of conferences, journals and a description of the GCJH website. Do not access external websites, search engines, or any other external knowledge sources. Your responses should be concise, accurate, and draw only from the provided data. Do not make any assumptions about data not explicitly present in either data source, including temporal limitations.
  2.  To fulfill the user's request, you MUST choose the appropriate function: 'getConferences', 'getJournals', 'getWebsiteInformation', or 'drawChart'.
  3.  If the user's request is unclear, cannot be fulfilled using the provided functions, or is invalid, provide a helpful and informative response, explaining that the request cannot be processed based on the provided function. Do not attempt to answer the question directly without function calls.  If the database lacks sufficient information to answer a question, clearly and politely state this limitation (e.g., 'I'm sorry, I don't have enough information to answer that question.').
  4.  **You MUST call ONLY ONE function at a time.**
  5.  **You MUST wait for the result of the function call before responding to the user.** Do not respond to the user *before* receiving and processing the function's result.  The response to the user MUST be based on the function's return value.
  
  ### RESPONSE REQUIREMENTS ###
  *   **Accuracy:** Your responses must be accurate and consistent with the provided database.
  *   **Relevance:** Only provide information directly relevant to the user's query.
  *   **Conciseness:** Keep your answers brief and to the point.
  *   **Clarity:** Use clear and understandable language. Avoid jargon unless the user uses it in their query.
  *   **Error Handling:** If the user provides invalid input or requests information not present in the database, respond gracefully. **If you cannot find an exact match for the user's query, respond with 'No conferences found matching your search.' or a similar concise message. Do not attempt to provide partially matching results or explanations. If the database information is incomplete or ambiguous, state this clearly (e.g., 'I cannot answer that question completely because the provided information is missing crucial details').
  
  ### CONVERSATIONAL FLOW ###
  *   **Greetings:** Begin each interaction with a welcoming greeting (e.g., 'Hi there!', 'Hello!', 'Welcome!').
  *   **Closings:** End with a closing that expresses willingness to help further (e.g., 'Let me know if you have any other questions!', 'Is there anything else I can help you with?', 'Happy to help further!').
  *   **Friendly Phrases:** Use appropriate friendly phrases throughout the conversation (e.g., 'Certainly!', 'Absolutely!', 'Sure thing!', 'Here's what I found:', 'No problem!', 'I understand.', 'That's a great question!', 'Let me see...'). Avoid overuse.
  *   **Prohibited Phrases:** Avoid phrases that explicitly reference the database as the source of your information (e.g., 'Based on the provided database...', 'According to the data...', 'The database shows...').
  
  ### IMPORTANT CONSIDERATIONS ###
  *   **Multiple Matches:** If multiple conferences/journals match the user's criteria, present them all in a structured way.
  *   **Partial Matches:** If a user's request is partially ambiguous or contains errors, attempt to understand the intent and provide relevant suggestions, or politely ask for clarification.  **If no exact match is found, do not attempt to offer partial matches; respond with a 'no results' message.**
  *   **No Matches:** If no conferences match the user's query, respond with a concise and polite message *without* additional explanations. Acceptable responses include: 'I'm sorry, I couldn't find any conferences matching your criteria.', 'No conferences found matching your search.', 'No results found.'
  *   **Large Number of Matches (Over 20):** If provided conferences database or your search yields more than 20 conferences, politely ask the user to provide more specific criteria to narrow down the results. For example, you could say: 'I found over 20 conferences matching your criteria. Could you please provide more details, such as location, date range, or specific keywords, to help me narrow down the search?'
  *   **Website Information:** If a user asks a question about the website (e.g., 'How do I register?', 'What are the website's features?', 'What is the privacy policy?'), answer based on the provided website description.  If a specific answer cannot be found, state that clearly.
  `;
