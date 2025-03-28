import csv from 'csv-parser';
import { createReadStream, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
dotenv.config();

const FILTER_MODEL_NAME = process.env.FILTER_MODEL_NAME || 'gemini-1.5-pro-latest';  // Add a default model
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  const errorMessage = "GEMINI_API_KEY is not set in the environment variables.";
  console.error(errorMessage);
  throw new Error(errorMessage);
}

const genAI = new GoogleGenerativeAI(API_KEY);

interface FilterGenerationConfig {
  temperature: number;
  topP: number;
  topK: number;
  maxOutputTokens: number;
  responseMimeType?: string;  // Optional property
}

const filterGenerationConfig: FilterGenerationConfig = {
  temperature: parseFloat(process.env.FILTER_TEMPERATURE || "0"),
  topP: parseFloat(process.env.FILTER_TOP_P || "0"),
  topK: parseInt(process.env.FILTER_TOP_K || "0", 10),
  maxOutputTokens: parseInt(process.env.FILTER_MAX_OUTPUT_TOKENS || "0", 10),
  responseMimeType: process.env.FILTER_RESPONSE_MIME_TYPE,
};

interface ConferenceCriteria {
  "ConferencesNameList"?: string[];
  "ConferencesAcronymList"?: string[];
  AverageRating?: string | string[];
  Source?: string | string[];
  PrimaryFoR?: string | string[];
  Type?: string | string[];
  Continent?: string | string[];
  Country?: string | string[];
  Rank?: string | string[];
  Topics?: string | string[];
  "Conference dates"?: string | string[];
  "Submission date"?: string | string[];
  "Notification date"?: string | string[];
  "Camera-ready date"?: string | string[];
  "Registration date"?: string | string[];
  [key: string]: string | string[] | undefined; // Allows other properties
}

interface Conference {
  "Conference name": string;
  "Acronym": string;
  "Source": string;
  "Rank": string;
  "Average rating": string;
  "Primary field of research": string;
  "Official website": string;
  "Summary"?: string;
  "Call for papers"?: string;
  "Information"?: string;
}

interface AlphanumericParts {
  text: string[];
  numbers: string[];
}

function extractAlphanumericParts(input: string | undefined): AlphanumericParts {
  if (!input) {
    return { text: [], numbers: [] };
  }

  const textParts: string[] = [];
  const numberParts: string[] = [];
  const parts = input.split(/(\d+)/); // Split on numbers

  for (let part of parts) {
    if (isNaN(Number(part))) {
      // It's text
      textParts.push(part.trim());
    } else {
      // It's a number
      numberParts.push(part.trim());
    }
  }

  return { text: textParts, numbers: numberParts };
}

async function filterConferences(criteria: ConferenceCriteria, csvFilePath: string, outputFilePath: string): Promise<string> {
  console.log(`filterConferences - Criteria received: ${JSON.stringify(criteria)}, CSV Path: ${csvFilePath}, Output Path: ${outputFilePath}`);
  return new Promise((resolve, reject) => {
    const results: Conference[] = [];

    try {
      createReadStream(csvFilePath)
        .on('error', (streamErr) => {
          console.error(`filterConferences - Error creating read stream for CSV file: ${csvFilePath}`, streamErr);
          reject(streamErr);
          return; // Stop processing if stream creation fails
        })
        .pipe(csv())
        .on('data', (row: any) => { // Explicitly type 'row' as 'any' to avoid type errors, better is to define row type
          try {
            let isMatch = true;

            if (criteria["ConferencesNameList"]) {
              console.log(criteria["ConferencesNameList"])
              const nameMatch = criteria["ConferencesNameList"].some(
                (criteriaName) => row["Name"] && row["Name"].toLowerCase().includes(criteriaName.toLowerCase())
              );
              if (!nameMatch) {
                isMatch = false;
              }
            }

            if (criteria["ConferencesAcronymList"]) {
              const acronymMatch = criteria["ConferencesAcronymList"].some(
                (criteriaAcronym) => row["Acronym"] && row["Acronym"].toLowerCase().includes(criteriaAcronym.toLowerCase())
              );
              if (!acronymMatch) {
                isMatch = false;
              }
            }

            for (let key of ["AverageRating", "Source", "PrimaryFoR", "Type", "Continent", "Country", "Rank", "Topics"]) {
              if (criteria[key]) {
                try {
                  const isArray = Array.isArray(criteria[key]);
                  if (isArray) {
                    const arrayMatch = (criteria[key] as string[]).some( // Type assertion here
                      (value) => row[key] && row[key].toLowerCase().includes(value.toLowerCase())
                    );
                    if (!arrayMatch) {
                      isMatch = false;
                    }
                  } else {
                    const singleMatch = row[key] && row[key].toLowerCase().includes((criteria[key] as string).toLowerCase()); // Type assertion here
                    if (!singleMatch) {
                      isMatch = false;
                    }
                  }
                } catch (comparisonError) {
                  console.error(`filterConferences - Error during criteria comparison for key '${key}':`, comparisonError);
                  isMatch = false; // Treat comparison error as no match to prevent unexpected results.
                }
              }
            }

            for (let dateKey of ["ConferenceDates", "SubmissionDate", "NotificationDate", "CameraReadyDate", "RegistrationDate"]) {
              if (criteria[dateKey]) {
                try {
                  const criteriaDates = Array.isArray(criteria[dateKey]) ? criteria[dateKey] : [criteria[dateKey]];
                  let isMatchDate = false;

                  for (const criteriaDate of criteriaDates) {
                    try {
                      const criteriaParts = extractAlphanumericParts(criteriaDate);
                      const rowParts = extractAlphanumericParts(row[dateKey]);

                      if (!row[dateKey]) continue; // Skip if row date is empty

                      let textMatch = false;
                      if (criteriaParts.text.length > 0 && rowParts.text.length > 0) {
                        textMatch = criteriaParts.text.some(criteriaText =>
                          rowParts.text.some(rowText => rowText.toLowerCase().includes(criteriaText.toLowerCase()))
                        );
                      } else if (criteriaParts.text.length === 0) {
                        textMatch = true; // No text criteria, consider text part matched
                      }

                      let numberMatch = true; // Assume number match if no number criteria
                      if (criteriaParts.numbers.length > 0) {
                        numberMatch = criteriaParts.numbers.every(criteriaNumber =>
                          rowParts.numbers.some(rowNumber => rowNumber === criteriaNumber)
                        );
                      }

                      if (textMatch && numberMatch) {
                        isMatchDate = true;
                        break;
                      }
                    } catch (dateProcessingError) {
                      console.error(`filterConferences - Error processing date criteria for key '${dateKey}' and criteriaDate '${criteriaDate}':`, dateProcessingError);
                      continue; // Continue to next criteria date in case of error
                    }
                  }

                  if (!isMatchDate) {
                    isMatch = false;
                  }
                } catch (dateCriteriaError) {
                  console.error(`filterConferences - Error processing date criteria for key '${dateKey}':`, dateCriteriaError);
                  isMatch = false; // Treat date criteria error as no match.
                }
              }
            }

            if (isMatch) {
              const conference: Conference = {
                "Conference name": row["Name"],
                "Acronym": row["Acronym"],
                "Source": row["Source"],
                "Rank": row["Rank"],
                "Average rating": row["Rating"],
                "Primary field of research": row["PrimaryFoR"],
                "Official website": row["Link"],
                "Summary": row["Summary"],
                "Call for papers": row["Call for papers"],
                "Information": row["Information"] || undefined // Ensure Information is included, handle undefined
              };

              if (row["Information"] && !row["Information"].trim().toLowerCase().startsWith("no")) {
                conference["Information"] = row["Information"];
              }

              results.push(conference);
            }
          } catch (rowDataProcessingError) {
            console.error(`filterConferences - Error processing row data:`, rowDataProcessingError);
            // Consider if you want to reject the whole promise or just skip the row. For now, skip the row:
            return; // Skip to next row
          }
        })
        .on('end', () => {
          try {
            const output = results.map((conf, index) => {
              return `${index + 1}. Conference name: ${conf["Conference name"]}\n` +
                `Acronym: ${conf["Acronym"]}\n` +
                `Source: ${conf["Source"]}\n` +
                `Rank: ${conf["Rank"]}\n` +
                `Average rating: ${conf["Average rating"]}\n` +
                `Primary field of research: ${conf["Primary field of research"]}\n` +
                `Official website: ${conf["Official website"]}\n` +
                `${conf["Information"] ? conf["Information"] + '\n' : ''}` +
                `${conf["Summary"] ? conf["Summary"] + '\n' : ''}` +
                `${conf["Call for papers"] ? conf["Call for papers"] + '\n' : ''}`;
            }).join('\n');

            try {
              writeFileSync(outputFilePath, output);
              console.log(`filterConferences - Results written to ${outputFilePath}`);
              resolve(output);
            } catch (fileWriteError) {
              console.error(`filterConferences - Error writing results to file: ${outputFilePath}`, fileWriteError);
              reject(fileWriteError);
            }
          } catch (outputProcessingError) {
            console.error(`filterConferences - Error processing and formatting output:`, outputProcessingError);
            reject(outputProcessingError);
          }
        })
        .on('error', (err) => {
          console.error(`filterConferences - CSV parsing error:`, err);
          reject(err);
        });
    } catch (mainError) {
      console.error(`filterConferences - An unexpected error occurred in the main function flow:`, mainError);
      reject(mainError);
    }
  });
}

interface JournalCriteria {
  Title?: string | string[];
  Type?: string | string[];
  Issn?: string | string[];
  "SJR Best Quartile"?: string | string[];
  Country?: string | string[];
  Region?: string | string[];
  Publisher?: string | string[];
  Coverage?: string | string[];
  Categories?: string | string[];
  Areas?: string | string[];
  Rank?: string | string[] | string;
  Sourceid?: string | string[] | string;
  "H index"?: string | string[] | string;
  "Total Docs. (2023)"?: string | string[] | string;
  "Total Docs. (3years)"?: string | string[] | string;
  "Total Refs."?: string | string[] | string;
  "Total Cites (3years)"?: string | string[] | string;
  "Citable Docs. (3years)"?: string | string[] | string;
  "Cites / Doc. (2years)"?: string | string[] | string;
  "Ref. / Doc."?: string | string[] | string;
  "%Female"?: string | string[] | string;
  Overton?: string | string[] | string;
  SDG?: string | string[] | string;
  "Impact Factor"?: string | string[] | string;
  Year?: string | string[] | string;

  [key: string]: string | string[] | string | undefined;
}

interface Journal {
  Rank: string;
  Sourceid: string;
  Title: string;
  Type: string;
  Issn: string;
  SJR: string;
  "SJR Best Quartile": string;
  "H index": string;
  "Total Docs. (2023)": string;
  "Total Docs. (3years)": string;
  "Total Refs.": string;
  "Total Cites (3years)": string;
  "Citable Docs. (3years)": string;
  "Cites / Doc. (2years)": string;
  "Ref. / Doc.": string;
  "%Female": string;
  Overton: string;
  SDG: string;
  Country: string;
  Region: string;
  Publisher: string;
  Coverage: string;
  Categories: string;
  Areas: string;
  "Impact Factor": string;
  Year: string;
}

async function filterJournals(criteria: JournalCriteria, csvFilePath: string, outputFilePath: string): Promise<string> {
  console.log(`filterJournals - Criteria received: ${JSON.stringify(criteria)}, CSV Path: ${csvFilePath}, Output Path: ${outputFilePath}`);
  return new Promise((resolve, reject) => {
    const results: Journal[] = [];

    try {
      createReadStream(csvFilePath)
        .on('error', (streamErr) => {
          console.error(`filterJournals - Error creating read stream for CSV file: ${csvFilePath}`, streamErr);
          reject(streamErr);
          return; // Stop processing if stream creation fails
        })
        .pipe(csv({ separator: ';' })) // Specify the separator
        .on('data', (row: any) => { //TODO: define row type
          try {
            let isMatch = true;

            // --- String-based comparisons (similar to filterConferences) ---
            const stringKeys = ["Title", "Type", "Issn", "SJR Best Quartile", "Country", "Region", "Publisher", "Coverage", "Categories", "Areas"];

            for (let key of stringKeys) {
              if (criteria[key]) {
                try {
                  const isArray = Array.isArray(criteria[key]);
                  if (isArray) {
                    const arrayMatch = (criteria[key] as string[]).some(  // Type assertion here
                      (value) => row[key] && row[key].toLowerCase().includes(value.toLowerCase())
                    );
                    if (!arrayMatch) {
                      isMatch = false;
                    }
                  } else {
                    const singleMatch = row[key] && row[key].toLowerCase().includes((criteria[key] as string).toLowerCase()); // Type assertion here
                    if (!singleMatch) {
                      isMatch = false;
                    }
                  }
                } catch (stringComparisonError) {
                  console.error(`filterJournals - Error during string criteria comparison for key '${key}':`, stringComparisonError);
                  isMatch = false; // Treat comparison error as no match
                }
              }
            }


            // --- Numerical comparisons (new logic) ---
            const numericalKeys = ["Rank", "Sourceid", "H index", "Total Docs. (2023)", "Total Docs. (3years)", "Total Refs.",
              "Total Cites (3years)", "Citable Docs. (3years)", "Cites / Doc. (2years)", "Ref. / Doc.",
              "%Female", "Overton", "SDG", "Impact Factor", "Year" // Added Impact Factor and Year
            ];

            for (let key of numericalKeys) {
              if (criteria[key]) {
                try {
                  const criteriaValue = criteria[key];
                  // Important: Handle comma as decimal separator
                  const rowValue = parseFloat(row[key] ? row[key].replace(',', '.') : NaN);

                  if (isNaN(rowValue)) {
                    isMatch = false;  // If the row's value is not a number, it can't match
                    continue;
                  }

                  if (typeof criteriaValue === 'string') {
                    const operatorRegex = /([<>]=?|=)(\d+(\.\d+)?)/; // Regex for operators like >, >=, =, <=, <
                    const match = criteriaValue.match(operatorRegex);

                    if (match) {
                      const operator = match[1];
                      const criteriaNumber = parseFloat(match[2]);

                      if (isNaN(criteriaNumber)) {
                        isMatch = false; // Invalid criteria number.
                        continue;
                      }

                      switch (operator) {
                        case '>':
                          if (!(rowValue > criteriaNumber)) isMatch = false;
                          break;
                        case '>=':
                          if (!(rowValue >= criteriaNumber)) isMatch = false;
                          break;
                        case '<':
                          if (!(rowValue < criteriaNumber)) isMatch = false;
                          break;
                        case '<=':
                          if (!(rowValue <= criteriaNumber)) isMatch = false;
                          break;
                        case '=':
                          if (!(rowValue === criteriaNumber)) isMatch = false;
                          break;
                        default:
                          isMatch = false; // Invalid operator
                      }
                    }
                    else if (!isNaN(parseFloat(criteriaValue))) {
                      //if criteria is number, it will check equal
                      if (rowValue != parseFloat(criteriaValue)) isMatch = false;
                    }
                    else {
                      isMatch = false; // Invalid criteria format
                    }
                  } else if (Array.isArray(criteriaValue)) {
                    //handle array of number, check if the rowValue is one of element of criteriaValue
                    let arrayMatch = false;
                    for (let value of criteriaValue) {
                      if (rowValue == parseFloat(value)) {
                        arrayMatch = true;
                        break;
                      }
                    }
                    if (!arrayMatch) isMatch = false;

                  } else {
                    isMatch = false; // Unsupported criteria type
                  }
                } catch (numericalComparisonError) {
                  console.error(`filterJournals - Error during numerical criteria comparison for key '${key}':`, numericalComparisonError);
                  isMatch = false; // Treat comparison error as no match
                }
              }
            }


            if (isMatch) {
              const journal: Journal = {
                "Rank": row["Rank"],
                "Sourceid": row["Sourceid"],
                "Title": row["Title"],
                "Type": row["Type"],
                "Issn": row["Issn"],
                "SJR": row["SJR"],
                "SJR Best Quartile": row["SJR Best Quartile"],
                "H index": row["H index"],
                "Total Docs. (2023)": row["Total Docs. (2023)"],
                "Total Docs. (3years)": row["Total Docs. (3years)"],
                "Total Refs.": row["Total Refs."],
                "Total Cites (3years)": row["Total Cites (3years)"],
                "Citable Docs. (3years)": row["Citable Docs. (3years)"],
                "Cites / Doc. (2years)": row["Cites / Doc. (2years)"],
                "Ref. / Doc.": row["Ref. / Doc."],
                "%Female": row["%Female"],
                "Overton": row["Overton"],
                "SDG": row["SDG"],
                "Country": row["Country"],
                "Region": row["Region"],
                "Publisher": row["Publisher"],
                "Coverage": row["Coverage"],
                "Categories": row["Categories"],
                "Areas": row["Areas"],
                "Impact Factor": row["Impact Factor"], // Add to output
                "Year": row["Year"] // Add to output
              };
              results.push(journal);
            }
          } catch (rowDataProcessingError) {
            console.error(`filterJournals - Error processing row data:`, rowDataProcessingError);
            return; // Skip to the next row
          }
        })
        .on('end', () => {
          try {
            const output = results.map((journal, index) => {
              // Build the output string (more concise string interpolation)
              return `${index + 1}.\n` +
                Object.entries(journal)
                  .filter(([, value]) => value !== undefined && value !== null && value !== "")  // Exclude empty values
                  .map(([key, value]) => `${key}: ${value}`).join('\n') + '\n';
            }).join('\n');

            try {
              writeFileSync(outputFilePath, output);
              console.log(`filterJournals - Results written to ${outputFilePath}`);
              resolve(output);
            } catch (fileWriteError) {
              console.error(`filterJournals - Error writing results to file: ${outputFilePath}`, fileWriteError);
              reject(fileWriteError);
            }

          } catch (outputProcessingError) {
            console.error(`filterJournals - Error processing and formatting output:`, outputProcessingError);
            reject(outputProcessingError);
          }
        })
        .on('error', (err) => {
          console.error(`filterJournals - CSV parsing error:`, err);
          reject(err);
        });
    } catch (mainError) {
      console.error(`filterJournals - An unexpected error occurred in the main function flow:`, mainError);
      reject(mainError);
    }
  });
}


interface UserIntent {
  Intent: string[];
  About: string;
  "Filter conference"?: any; // Replace 'any' with the actual type if known
  "Filter journal"?: any; // Replace 'any' with the actual type if known
  Redirect?: any; // Replace 'any' with the actual type if known
  Description: string;
}

async function determineUserIntent(questionList: string): Promise<UserIntent | null> {
  console.log("Danh sách câu hỏi:", questionList);

  const parts = [
    { text: "**Role (R):** You are a highly skilled AI assistant specializing in understanding user requests related to academic conferences, journals, and website navigation. Your primary task is to analyze user input and structure it into a valid JSON format according to the provided examples and schema .\n\n**Instruction (I):**\n\n1.  **Intent Recognition:**\n    *   First and foremost, identify the primary *Intent* of the user's request. The `Intent` MUST be one of the following (and can have multiple values):\n        *   `\"No intent\"`:  Use this ONLY for simple greetings or conversational fillers that do not require a specific action. *Do not attempt to extract information from these inputs.*\n        *   `\"Find information\"`: The user is asking for information about conferences, journals, or the website itself.\n        *   `\"Draw chart\"`: The user is requesting a chart or visualization.\n        *   `\"Website navigation\"`: The user wants to be redirected to a specific page on the website.\n        *   `\"Invalid\"`: The user's request is outside the scope of your capabilities (e.g., asking about general world events) or is inherently impossible to fulfill (e.g., navigating to two different URLs simultaneously).\n\n2.  **Prioritization :**\n    *   If there is only one thing, then that is the intent\n    *   if there are two things and they have equal meaning, provide both.\n    *   If there are two things, that cannot be done, mark as invalid and prompt.\n    *   If there are website navigation, and find information. then set website navigation as the default.\n\n3.  **Handling Invalid Intents:**\n    *   If the `Intent` is set to `\"Invalid\"`, *ONLY* include the `Intent` and `Description` properties in the JSON. *Do NOT include* the `About`, `Filter conference`, `Filter journal`, or `Redirect` properties.\n    *   The `Description` must clearly explain *why* the request is considered invalid.\n\n4.  **Extract Relevant Entities:**\n\n    *   Based on the identified `Intent`, extract the relevant entities from the user's input and map them to the appropriate properties in the schema.\n    *   Be mindful of the data types and enums defined in the schema.\n\n5.  **`About` Property:**\n\n    *   If the `Intent` is NOT `\"Invalid\"`, determine the `About` property:\n        *   `\"Conference\"`: The request relates to academic conferences.\n        *   `\"Journal\"`: The request relates to academic journals.\n        *   `\"Website\"`: The request relates to the website itself (navigation, features, etc.).\n        *   `\"Invalid\"`: If the request doesn't fit the above, even with a *valid* Intent, but the intent must be valid.\n\n6.  **Filtering (Filter conference and Filter journal):**\n\n    *   If the `Intent` is `\"Find information\"` and the `About` property is `\"Conference\"` or `\"Journal\"`, populate the appropriate filter object (`Filter conference` or `Filter journal`) with the extracted criteria:\n        *   **Arrays:** Use arrays for properties that can have multiple values (e.g., `Topics`, `Country`, `Rank`).\n        *   **Enums:** Ensure that enum values (e.g., `Type`, `Rank`, `Continent`) are chosen from the allowed list.\n        *   **Dates:** Represent date ranges using the `\"Conference dates\"`, `\"Submission date\"`, etc. properties as strings.\n        *   **Irrelevant parameters:** Only include what has been specified by the user. If the values do not apply to the filters then *do not include them*.\n\n7.  **Website Navigation (`Redirect`):**\n    *   If the `Intent` is `\"Website navigation\"`, populate the `Redirect` object:\n        *   `Type`:  Choose the appropriate type (`\"Internal website\"`, `\"Conference website\"`, `\"Journal website\"`, or `\"Invalid\"`).\n        *   `Value`: Set the target URL or path. If a valid URL cannot be determined or if the request is ambiguous, set `\"Value\"` to `null` and provide a descriptive message to the user.\n        *   `Message`: Provide a user-friendly confirmation or explanation message. This is *required*.\n\n8.  **Context Maintenance:**\n\n    *   Remember the context from previous turns in the conversation.\n    *   If the user provides new criteria, *replace* the old values with the new ones, *unless* the user is explicitly adding to existing criteria.\n    *   If the user expresses a new `Intent`, reset the context and start with the new `Intent`.\n    *   Always try to assume the context is related, unless the previous intent is specifically about an error, or the about is invalid, then reset.\n\n9.  **Description:**\n    *   Always provide a concise and accurate `Description` of the user's request and the actions the system will take.\n    *   Be specific, but not overly verbose.\n\n**Style (S):**\n\n*   Be accurate and precise in your JSON formatting. Adhere strictly to the provided examples and schema.\n*   Be clear and concise in your descriptions.\n*   Prioritize clarity and usability over creative writing." },
    { text: "input: User question 1: Draw a bar chart showing the number of conferences by continent." },
    { text: "output: {\n  \"Intent\": [\n    \"Draw chart\"\n  ],\n  \"About\": \"Conference\",\n  \"Description\": \"The user is requesting a bar chart visualization displaying the number of conferences per continent.\"\n}" },
    { text: "input: User question 1: Draw a bar chart showing the number of conferences by continent.\nUser question 2: Change it to a pie chart.\nUser question 3: Add the title \"Conference Distribution by Continent\"." },
    { text: "output: {\n  \"Intent\": [\n    \"Draw chart\"\n  ],\n  \"About\": \"Conference\",\n  \"Description\": \"The user is requesting a pie chart visualization displaying the number of conferences per continent, with the title 'Conference Distribution by Continent'.\"\n}" },
    { text: "input: User question 1: Create a line chart showing the number of conferences per source.\nUser question 2: Compare conferences of Asia, Europe and North America Continent on the same chart.\nUser question 3: Make the line for North America purple." },
    { text: "output: {\n  \"Intent\": [\n    \"Draw chart\"\n  ],\n  \"About\": \"Conference\",\n  \"Description\": \"The user is requesting a line chart visualization displaying the number of conferences per source, comparing conferences from Asia, Europe, and North America. The line representing North America should be purple.\"\n}" },
    { text: "input: User question 1: Create a line chart showing the number of conferences per source.\nUser question 2: Compare conferences of Asia, Europe and North America Continent on the same chart.\nUser question 3: Make the line for North America purple.\nUser question 4: Hello, who are you ?" },
    { text: "output: {\n  \"Intent\": [\n    \"No intent\"\n  ],\n  \"Description\": \"The user is inquiring about the my identity and capabilities.\"\n}" },
    { text: "input: User question 1: Draw a pie chart show number of conference of France, Germany and USA\nUser question 2: Add Vietnam to chart" },
    { text: "output: {\n  \"Intent\": [\n    \"Draw chart\"\n  ],\n  \"About\": \"Conference\",\n  \"Description\": \"The user is requesting a pie chart visualization displaying the number of conferences in France, Germany, USA, and Vietnam.\"\n}" },
    { text: "input: User question 1: Hello\nUser question 2: I want to know about conferences in Hybrid format ?\nUser question 3: Take place in Asia from May to December 2025\nUser question 4: Ok list all conferences take place in Viet Nam\nUser question 5: Relevant to AI\nUser question 6: Submission deadline in May\nUser question 7: last week of May\nUser question 8: Official website" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Filter conference\": {\n    \"Topics\": [\n      \"AI\",\n      \"Artificial Intelligence\"\n    ],\n    \"Country\": [\n      \"Vietnam\"\n    ],\n    \"Type\": [\n      \"Hybrid\"\n    ],\n    \"Continent\": [\n      \"Asia\"\n    ],\n    \"Conference dates\": \"May - December, 2025\",\n    \"Submision date\": \"May, 2025\"\n  },\n  \"Description\": \"The user is seeking information about Hybrid conferences related to AI and Artificial Intelligence taking place in Vietnam (within Asia) between May and December 2025, with a submission deadline in late May 2025.\"\n}" },
    { text: "input: User question 1: Hello\nUser question 2: I want to know about conferences in Hybrid format ?\nUser question 3: Take place in Asia from May to December 2025\nUser question 4: Ok list all conferences take place in Viet Nam\nUser question 5: Relevant to AI\nUser question 6: Submission deadline in May\nUser question 7: last week of May\nUser question 8: Official website" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Filter conference\": {\n    \"Topics\": [\n      \"AI\",\n      \"Artificial Intelligence\"\n    ],\n    \"Country\": [\n      \"Vietnam\"\n    ],\n    \"Type\": [\n      \"Hybrid\"\n    ],\n    \"Continent\": [\n      \"Asia\"\n    ],\n    \"Conference dates\": \"May - December, 2025\",\n    \"Submission date\": \"May, 2025\"\n  },\n  \"Description\": \"The user wants to find information about Hybrid conferences in the field of AI and Artificial Intelligence, held in Vietnam, in Asia, taking place between May and December 2025, and having a submission deadline in May 2025.\"\n}" },
    { text: "input: User question 1: Hello\nUser question 2: I want to know about conferences in Hybrid format ?\nUser question 3: Take place in Asia from May to December 2025\nUser question 4: Ok list all conferences take place in Viet Nam\nUser question 5: Relevant to AI\nUser question 6: Submission deadline in May\nUser question 7: last week of May\nUser question 8: Official website\nUser question 9: List again conferences in my second question" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Filter conference\": {\n    \"Type\": [\n      \"Hybrid\"\n    ]\n  },\n  \"Description\": \"The user is looking for information about Hybrid conferences.\"\n}" },
    { text: "input: User question 1: Hello\nUser question 2: I want to know about conferences in Hybrid format ?\nUser question 3: Take place in Asia from May to December 2025\nUser question 4: Ok list all conferences take place in Viet Nam\nUser question 5: Relevant to AI\nUser question 6: Submission deadline in May\nUser question 7: last week of May\nUser question 8: Official website\nUser question 9: List again conferences in my third question" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Filter conference\": {\n    \"Continent\": [\n      \"Asia\"\n    ],\n    \"Conference dates\": \"May - December, 2025\"\n  },\n  \"Description\": \"The user wants to find information about conferences in Asia held between May and December 2025.\"\n}" },
    { text: "input: User question 1: Hello\nUser question 2: I want to know about conferences in Hybrid format ?\nUser question 3: Take place in Asia from May to December 2025\nUser question 4: Ok list all conferences take place in Viet Nam\nUser question 5: Relevant to AI\nUser question 6: Submission deadline in May\nUser question 7: last week of May\nUser question 8: Official website\nUser question 9: List again conferences in Asian" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Filter conference\": {\n    \"Continent\": [\n      \"Asia\"\n    ]\n  },\n  \"Description\": \"The user wants to find information about conferences in Asia.\"\n}" },
    { text: "input: User question 1: Hello\nUser question 2: I want to know about conferences in Hybrid format ?\nUser question 3: Take place in Asia from May to December 2025\nUser question 4: Ok list all conferences take place in Viet Nam\nUser question 5: Relevant to AI\nUser question 6: Submission deadline in May\nUser question 7: last week of May\nUser question 8: Official website\nUser question 9: List again conferences in Asian but in all format" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Filter conference\": {\n    \"Continent\": [\n      \"Asia\"\n    ]\n  },\n  \"Description\": \"Following a series of questions refining conference search criteria, the user now requests a list of conferences taking place in Asia, in any format (Hybrid, Offline, Online). Previously, the user specified a hybrid format, Vietnam as the location, AI as the topic, and May 2025 as the submission deadline. This request overrides the previous location and format constraints, focusing solely on Asia and removing the format restriction.\"\n}" },
    { text: "input: User question 1: Hello\nUser question 2: I want to know about conferences in Hybrid format ?\nUser question 3: Take place in Asia from May to December 2025\nUser question 4: Ok list all conferences take place in Viet Nam\nUser question 5: Relevant to AI\nUser question 6: Submission deadline in May\nUser question 7: last week of May\nUser question 8: Official website\nUser question 9: List again conferences in Asian but in all format\nUser question 10: I have a research paper in Automation area, specific in AI computer automation, can you suggest me some conferences fit for me ?" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Filter conference\": {\n    \"Continent\": [\n      \"Asia\"\n    ],\n    \"Topics\": [\n      \"AI\",\n      \"Artificial Intelligence\",\n      \"Automation\",\n      \"Computer Automation\"\n    ],\n    \"Type\": [\n       \"Hybrid\",\n       \"Offline\",\n       \"Online\"\n    ],\n    \"Submission date\": \"May, 2025\"\n  },\n  \"Description\": \"Building on the user's previous requests, the system is now refining the conference search based on a specific research paper in the areas of Automation and Computer Automation, alongside the user's existing interest in AI. The search is for conferences in Asia, with submission deadlines in May 2025, and the user is open to all conference formats (Hybrid, Offline, and Online). The prior location constraint of Vietnam has been dropped.\"\n}" },
    { text: "input: User question 1: Hello\nUser question 2: I want to know about conferences in Hybrid format ?\nUser question 3: Take place in Asia from May to December 2025\nUser question 4: Ok list all conferences take place in Viet Nam\nUser question 5: Relevant to AI\nUser question 6: Submission deadline in May\nUser question 7: last week of May\nUser question 8: Official website\nUser question 9: List again conferences in Asian but in all format\nUser question 10: I have a research paper in Automation area, specific in AI computer automation, can you suggest me some conferences fit for me ?\nUser question 11: Im time range i specified" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Filter conference\": {\n    \"Continent\": [\n      \"Asia\"\n    ],\n    \"Topics\": [\n      \"AI\",\n      \"Artificial Intelligence\",\n      \"Automation\",\n      \"Computer Automation\"\n    ],\n    \"Conference dates\": \"May - December, 2025\",\n    \"Submission date\": \"May, 2025\"\n  },\n  \"Description\": \"The user is requesting conferences in Asia covering AI, Artificial Intelligence, Automation and Computer Automation. The conferences should take place between May and December 2025 with a submission deadline in May 2025. They are interested in conferences of all types (Hybrid, Online, Offline). The request is refined based on a research paper and uses the original time frame from the conversation.\"\n}" },
    { text: "input: User question 1: Hello\nUser question 2: I want to know about conferences in Hybrid format ?\nUser question 3: Take place in Asia from May to December 2025\nUser question 4: Ok list all conferences take place in Viet Nam\nUser question 5: Relevant to AI\nUser question 6: Submission deadline in May,, notification in June, Camera ready in June, registration in June\nUser question 7: submission in last week of May\nUser question 8: Official website" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Filter conference\": {\n    \"Topics\": [\n      \"AI\",\n      \"Artificial Intelligence\"\n    ],\n    \"Country\": [\n      \"Vietnam\"\n    ],\n    \"Type\": [\n      \"Hybrid\"\n    ],\n    \"Continent\": [\n      \"Asia\"\n    ],\n    \"Conference dates\": \"May - December, 2025\",\n    \"Submision date\": \"May, 2025\",\n    \"Notification date\": \"June, 2025\",\n    \"Camera-ready date\": \"June, 2025\",\n    \"Registration date\": \"June, 2025\"\n  },\n  \"Description\": \"The user is seeking information about Hybrid conferences related to AI and Artificial Intelligence taking place in Vietnam (within Asia) between May and December 2025. The specific deadlines are: Submission in late May 2025, Notification in June 2025, Camera-ready in June 2025, and Registration in June 2025.\"\n}" },
    { text: "input: User question 1: Hello\nUser question 2: I want to know about conferences in Hybrid format ?\nUser question 3: Take place in Asia from May to December 2025\nUser question 4: Ok list all conferences take place in Viet Nam\nUser question 5: Relevant to AI\nUser question 6: Submission deadline in May\nUser question 7: last week of May\nUser question 8: Official website\nUser question 9: List again conferences in Asian but in all format\nUser question 10: I have a research paper in Automation area, specific in AI computer automation, can you suggest me some conferences fit for me ?\nUser question 11: Im time range i specified\nUser question 12: Details about dates in these conferences\nUser question 13: Do any of the above conferences have notification dates in July?\nUser question 14: Tell me details about AAAI conference" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Filter conference\": {\n    \"ConferencesAcronymList\": [\n      \"AAAI\"\n    ]\n  },\n  \"Description\": \"The user is now specifically requesting details about the AAAI conference, building upon a previous search for conferences related to AI, Automation, and Computer Automation in Asia between May and December 2025. The user had previously expressed interest in submission deadlines in May and all conference types. The system should now focus solely on providing information about the AAAI conference, disregarding previous date constraints.\"\n}" },
    { text: "input: User question 1: Hello\nUser question 2: I want to know about conferences in Hybrid format ?\nUser question 3: Take place in Asia from May to December 2025\nUser question 4: Ok list all conferences take place in Viet Nam\nUser question 5: Relevant to AI\nUser question 6: Submission deadline in May\nUser question 7: last week of May\nUser question 8: Official website\nUser question 9: List again conferences in Asian but in all format\nUser question 10: I have a research paper in Automation area, specific in AI computer automation, can you suggest me some conferences fit for me ?\nUser question 11: In time range I specified\nUser question 12: Details about dates in these conferences\nUser question 13: Do any of the above conferences have notification dates in July?\nUser question 14: Tell me details about  International Conference on Ambient Systems, Networks and Technologies conference" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Filter conference\": {\n    \"ConferencesNameList\": [\n      \"International Conference on Ambient Systems, Networks and Technologies\"\n    ]\n  },\n  \"Description\": \"The user is now specifically requesting details about the 'International Conference on Ambient Systems, Networks and Technologies' conference, building upon a previous search for conferences related to AI, Automation, and Computer Automation in Asia between May and December 2025. The user had previously expressed interest in submission deadlines in May and all conference types. The system should now focus solely on providing information about the specified conference, potentially disregarding previous date and topic constraints if necessary to fulfill the request.\"\n}" },
    { text: "input: User question 1: Tell me details about  International Conference on Ambient Systems, Networks and Technologies and ACM International Conference on Advances in Geographic Information Systems" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Filter conference\": {\n    \"ConferencesNameList\": [\n      \"International Conference on Ambient Systems, Networks and Technologies\",\n      \"ACM International Conference on Advances in Geographic Information Systems\"\n    ]\n  },\n  \"Description\": \"The user is now requesting details about two specific conferences: the 'International Conference on Ambient Systems, Networks and Technologies' and the 'ACM International Conference on Advances in Geographic Information Systems'.  The system should focus on providing information about both of these conferences. Any previously established constraints (such as topic, date range, or location) from earlier in the conversation should be considered as *hints* but not strict requirements; prioritize providing details about the specified conferences, even if they don't perfectly match those earlier criteria.\"\n}" },
    { text: "input: User question 1: List all conferences in rank A and B focus on Education" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Filter conference\": {\n    \"Rank\": [\n      \"A\",\n      \"B\"\n    ],\n    \"Topics\": [\n      \"Education\"\n    ]\n  },\n  \"Description\": \"The user is requesting a list of conferences ranked A or B that focus on the topic of Education.\"\n}" },
    { text: "input: User question 1: List all conferences" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Description\": \"The user is requesting a list of all conferences without specifying any particular criteria.\"\n}" },
    { text: "input: User question 1: Hello" },
    { text: "output: {\n  \"Intent\": [\n    \"No intent\"\n  ],\n  \"Description\": \"The user initiated the conversation with a greeting.\"\n}" },
    { text: "input: User question 1: Who are you" },
    { text: "output: {\n  \"Intent\": [\n    \"No intent\"\n  ],\n  \"Description\": \"The user is inquiring about the my identity and capabilities.\"\n}" },
    { text: "input: User question 1: Hello, list me random 5 conference" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Description\": \"The user is requesting a list of five random conferences.\"\n}" },
    { text: "input: User question 1: Hello\nUser question 2: I want to know about conferences in Hybrid format ?\nUser question 3: Take place in Asia from May to December 2025\nUser question 4: Ok list all conferences take place in Viet Nam\nUser question 5: Relevant to AI\nUser question 6: Submission deadline in May,, notification in June, Camera ready in June, registration in June\nUser question 7: all in first week or last week of May or June\nUser question 8: Official website\nUser question 9: Ok now list all rank B conference" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Filter conference\": {\n    \"Rank\": [\n      \"B\"\n    ]\n  },\n  \"Description\": \"The user is now requesting a list of all conferences ranked B. This request supersedes previous criteria related to format (Hybrid), location (Asia and Vietnam), topic (AI), and specific dates (May-June 2025), focusing solely on rank B conferences.\"\n}" },
    { text: "input: User question 1: Hello\nUser question 2: I want to know about conferences in Hybrid format ?\nUser question 3: Take place in Asia from May to December 2025\nUser question 4: Ok list all conferences take place in Viet Nam\nUser question 5: Relevant to AI\nUser question 6: Submission deadline in May,, notification in June, Camera ready in June, registration in June\nUser question 7: all in first week or last week of May or June\nUser question 8: Official website\nUser question 9: Ok now list all Australian national rank conference (discard all before criteria)" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Filter conference\": {\n    \"Rank\": [\n      \"National\"\n    ],\n    \"Country\": [\n      \"Australia\"\n    ]\n  },\n  \"Description\": \"The user is now requesting a list of conferences with a National rank taking place in Australia.  All previous criteria related to format, location, topic, and dates have been discarded, focusing solely on conferences that are nationally ranked in Australia.\"\n}" },
    { text: "input: User question 1: Suggest me some conference with Baltic Regional rank" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Filter conference\": {\n    \"Rank\": [\n      \"Regional\"\n    ]\n  },\n  \"Description\": \"The user is requesting suggestions for conferences with a Regional rank. The user is assumed to be interested in the Baltic region based on the prompt.\"\n}" },
    { text: "input: User question 1: List for me some AI conferences  take place in 2025" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Filter conference\": {\n    \"Topics\": [\n      \"AI\",\n      \"Artificial Intelligence\"\n    ],\n    \"Conference dates\": \"January - December, 2025\"\n  },\n  \"Description\": \"The user is requesting a list of AI and Artificial Intelligence conferences taking place in 2025.\"\n}" },
    { text: "input: User question 1: Hi there.\nUser question 2: Find me conferences related to Natural Language Processing.\nUser question 3: In North America.\nUser question 4:  Preferably in the United States.\nUser question 5:  Any format is okay.\nUser question 6:  Taking place in 2025.\nUser question 7:  I'm interested in conferences with early submission deadlines, perhaps in January or February.\nUser question 8:  And notification dates around April.\nUser question 9:  Are there any top-tier conferences, like rank A* or A?\nUser question 10: List conferences with official websites available in the search result." },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Filter conference\": {\n    \"Topics\": [\n      \"Natural Language Processing\"\n    ],\n    \"Continent\": [\n      \"North America\"\n    ],\n    \"Country\": [\n      \"United States\"\n    ],\n    \"Conference dates\": \"January - December, 2025\",\n    \"Submission date\": \"January - February, 2025\",\n    \"Notification date\": \"April, 2025\",\n    \"Rank\": [\n      \"A*\",\n      \"A\"\n    ]\n  },\n  \"Description\": \"The user is requesting a list of top-tier (Rank A* or A) conferences related to Natural Language Processing taking place in North America, specifically in the United States, during 2025. They are interested in any conference format (Hybrid, Offline, or Online), with submission deadlines in January or February and notification dates around April. The search result should include only conferences with official websites available.\"\n}" },
    { text: "input: User question 1: Hello.\nUser question 2: List conferences in Asia.\nUser question 3:  Hybrid format preferred.\nUser question 4:  Dates in 2026.\nUser question 5:  Topics: Natural Language Processing.\nUser question 6: Show me rank A conferences.\nUser question 7:  What about conferences specifically named \"ICCV\"?" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Filter conference\": {\n    \"ConferencesAcronymList\": [\n      \"ICCV\"\n    ]\n  },\n  \"Description\": \"The user is now specifically requesting information about conferences with the acronym 'ICCV', shifting the search away from previous criteria related to location (Asia), format (Hybrid), dates (2026), topic (Natural Language Processing), and rank (A). The system should prioritize providing details about ICCV conferences, and previous search parameters should only be considered if relevant to those specific conferences.\"\n}" },
    { text: "input: User question 1:  Hello, I'm looking for conferences in Computer Science.\nUser question 2:  Specifically focusing on Software Engineering.\nUser question 3:  In Europe, perhaps UK or Ireland.\nUser question 4:  Hybrid or in-person format.\nUser question 5:  Taking place in Spring 2026, say April or May.\nUser question 6:  Submission deadline maybe around December 2025.\nUser question 7:  Are there any student paper competitions at these conferences?\nUser question 8:  Also, I'm interested in conferences with workshops on Agile methodologies." },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Conference\",\n  \"Filter conference\": {\n    \"Topics\": [\n      \"Software Engineering\",\n      \"Agile\"\n    ],\n    \"Continent\": [\n      \"Europe\"\n    ],\n    \"Country\": [\n      \"UK\",\n      \"United Kingdom\",\n      \"Ireland\"\n    ],\n    \"Type\": [\n      \"Hybrid\",\n      \"Offline\"\n    ],\n    \"Conference dates\": \"April - May, 2026\",\n    \"Submission date\": \"December, 2025\"\n  },\n  \"Description\": \"The user is requesting a list of conferences focused on Software Engineering and Agile methodologies, located in Europe (specifically the UK or Ireland), with a Hybrid or in-person format, taking place in April or May 2026, and having a submission deadline around December 2025. They are also interested in knowing if these conferences have student paper competitions.\"\n}" },
    { text: "input: User question 1: Take me to the About page." },
    { text: "output: {\n  \"Intent\": [\n    \"Website navigation\"\n  ],\n  \"About\": \"Website\",\n  \"Redirect\": {\n    \"Type\": \"Internal website\",\n    \"Value\": \"/about\",\n    \"Message\": \"Navigating to the About page now...\"\n  },\n  \"Description\": \"The user is requesting to be redirected to the 'About' page of the website. The system will redirect to the About page and display the confirmation message.\"\n}" },
    { text: "input: User question 1: Redirect me to the conferences page to see upcoming events." },
    { text: "output: {\n  \"Intent\": [\n    \"Website navigation\"\n  ],\n  \"About\": \"Conference\",\n  \"Redirect\": {\n    \"Type\": \"Internal website\",\n    \"Value\": \"/conferences\",\n    \"Message\": \"Taking you to the conferences page to view upcoming events!\"\n  },\n  \"Description\": \"The user is requesting to be redirected to the 'Conferences' page to view upcoming events. The system will redirect to the Conferences page and display the confirmation message.\"\n}" },
    { text: "input: User question 1: Take me to the support section of your site." },
    { text: "output: {\n  \"Intent\": [\n    \"Website navigation\"\n  ],\n  \"About\": \"Website\",\n  \"Redirect\": {\n    \"Type\": \"Internal website\",\n    \"Value\": \"/support\",\n    \"Message\": \"Redirecting you to the support section now.\"\n  },\n  \"Description\": \"The user is requesting to be redirected to the 'Support' section of the website. The system will redirect to the Support page and display the confirmation message.\"\n}" },
    { text: "input: User question 1: Take me to the page about 'dinosaurs'" },
    { text: "output: {\n  \"Intent\": [\n    \"Website navigation\"\n  ],\n  \"About\": \"Website\",\n  \"Redirect\": {\n    \"Type\": \"Internal website\",\n    \"Value\": null,\n    \"Message\": \"Sorry, but the page about 'dinosaurs' could not be found. Please verify the URL and try again.\"\n  },\n  \"Description\": \"The user requested navigation to a page about 'dinosaurs,' but that specific page does not exist on this website. The system will display an error and the provided message.\"\n}" },
    { text: "input: User question 1: Redirect me to ICCV official website" },
    { text: "output: {\n  \"Intent\": [\n    \"Website navigation\"\n  ],\n  \"About\": \"Conference\",\n  \"Redirect\": {\n    \"Type\": \"Conference website\",\n    \"Value\": \"Acronym: ICCV\"\n    \"Message\": \"Taking you to the official ICCV conference website now!\"\n  },\n  \"Description\": \"The user is requesting to be redirected to the official website of the ICCV conference. The system will redirect to the official website and display the confirmation message.\"\n}" },
    { text: "input: User question 1: Redirect me to Ca-A Cancer Journal for Clinicians" },
    { text: "output: {\n  \"Intent\": [\n    \"Website navigation\"\n  ],\n  \"About\": \"Journal\",\n  \"Redirect\": {\n    \"Type\": \"Journal website\",\n    \"Value\": \"Title: CA-A Cancer Journal for Clinicians\"\n    \"Message\": \"Sure! I'll redirect you to the official homepage of CA-A Cancer Journal for Clinicians.\"\n  },\n  \"Description\": \"The user is requesting to be redirected to the official website for the journal 'CA-A Cancer Journal for Clinicians'. The system will redirect to the official Journal website and display the confirmation message.\"\n}" },
    { text: "input: User question 1: I want to know a about Registration procedure of your website" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Website\",\n  \"Description\": \"The user is seeking information regarding the website's registration procedure.\"\n}" },
    { text: "input: User question 1: What features does the site have?" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Website\",\n  \"Description\": \"The user is asking about the features available on the website.\"\n}" },
    { text: "input: User question 1: Redirect me to AAAI official website and About page of this page" },
    { text: "output: {\n  \"Intent\": [\n    \"Invalid\"\n  ],\n  \"Description\": \"The user made an ambiguous request to be redirected to both the AAAI official website AND the 'About' page of *this* website. The system cannot perform both actions at once and will prompt the user to clarify their intent.\"\n}" },
    { text: "input: User question 1: Let me know about global situation" },
    { text: "output: {\n  \"Intent\": [\n    \"Invalid\"\n  ],\n  \"Description\": \"The user is asking about the current global situation. This query is outside the scope of the system's capabilities.\"\n}" },
    { text: "input: User question 1: Find journals with \"Cancer\" in the title.\nUser question 2: Show me journals with an H index greater than 300.\nUser question 3: I only want journals from the United Kingdom." },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Journal\",\n  \"Filter journal\": {\n    \"Title\": [\n      \"Cancer\"\n    ],\n    \"Categories\": [\n      \"Cancer\"\n    ],\n    \"H index\": \">300\",\n    \"Country\": [\n      \"United Kingdom\",\n      \"UK\"\n    ]\n  },\n  \"Description\": \"The user wants to find information about journals related to 'Cancer' with publications from 'United Kingdom'.\"\n}" },
    { text: "input: User question 1:  Show journals in the \"Medicine\" area.\nUser question 2:  List journals with Rank 1, 3, or 5.\nUser question 3: Find the journal which has Overton is 98.86." },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Journal\",\n  \"Filter journal\": {\n    \"Categories\": [\n      \"Medicine\"\n    ],\n    \"Rank\": [\n      \"1\",\n      \"3\",\n      \"5\"\n    ],\n    \"Overton\": \"98.86\"\n  },\n  \"Description\": \"The user is requesting a list of journals in the 'Medicine' area with ranks 1, 3, or 5, and an Overton score of 98.86.\"\n}" },
    { text: "input: User question 1: Show me journals with a title contains \"Nature\".\nUser question 2: Show me journals that located in United Kingdom.\nUser question 3: Show me journals that have SDG less than 30" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Journal\",\n  \"Filter journal\": {\n    \"Title\": [\n      \"Nature\"\n    ],\n    \"Categories\": [\n      \"Nature\"\n    ],\n    \"Country\": [\n      \"United Kingdom\",\n      \"UK\"\n    ],\n    \"SDG\": \"<30\"\n  },\n  \"Description\": \"The user wants to find information about journals with a title containing 'Nature' that are located in the 'United Kingdom', and have a SDG less than 30.\"\n}" },
    { text: "input: User queestion 1: Details about  journal with Title \"Ca-A Cancer Journal for Clinicians\"" },
    { text: "output: {\n  \"Intent\": [\n    \"Find information\"\n  ],\n  \"About\": \"Journal\",\n  \"Filter journal\": {\n    \"Title\": [\n      \"Ca-A Cancer Journal for Clinicians\"\n    ]\n  },\n  \"Description\": \"The user is requesting details about a journal with the title 'Ca-A Cancer Journal for Clinicians'.\"\n}" },
    { text: `input: ${questionList}` },
    { text: "output: " },
  ];

  const systemInstruction = `
**Role (R):** You are a highly skilled AI assistant specializing in understanding user requests related to academic conferences, journals, and website navigation. Your primary task is to analyze user input and structure it into a valid JSON format according to the provided examples and schema .

**Instruction (I):**

1.  **Intent Recognition:**
    *   First and foremost, identify the primary *Intent* of the user's request. The "Intent" MUST be one of the following (and can have multiple values):
        *   ""No intent"":  Use this ONLY for simple greetings or conversational fillers that do not require a specific action. *Do not attempt to extract information from these inputs.*
        *   ""Find information"": The user is asking for information about conferences, journals, or the website itself.
        *   ""Draw chart"": The user is requesting a chart or visualization.
        *   ""Website navigation"": The user wants to be redirected to a specific page on the website.
        *   ""Invalid"": The user's request is outside the scope of your capabilities (e.g., asking about general world events) or is inherently impossible to fulfill (e.g., navigating to two different URLs simultaneously).

2.  **Prioritization :**
    *   If there is only one thing, then that is the intent
    *   if there are two things and they have equal meaning, provide both.
    *   If there are two things, that cannot be done, mark as invalid and prompt.
    *   If there are website navigation, and find information. then set website navigation as the default.

3.  **Handling Invalid Intents:**
    *   If the "Intent" is set to ""Invalid"", *ONLY* include the "Intent" and "Description" properties in the JSON. *Do NOT include* the "About", "Filter conference", "Filter journal", or "Redirect" properties.
    *   The "Description" must clearly explain *why* the request is considered invalid.

4.  **Extract Relevant Entities:**

    *   Based on the identified "Intent", extract the relevant entities from the user's input and map them to the appropriate properties in the schema.
    *   Be mindful of the data types and enums defined in the schema.

5.  **"About" Property:**

    *   If the "Intent" is NOT ""Invalid"", determine the "About" property:
        *   ""Conference"": The request relates to academic conferences.
        *   ""Journal"": The request relates to academic journals.
        *   ""Website"": The request relates to the website itself (navigation, features, etc.).
        *   ""Invalid"": If the request doesn't fit the above, even with a *valid* Intent, but the intent must be valid.

6.  **Filtering (Filter conference and Filter journal):**

    *   If the "Intent" is ""Find information"" and the "About" property is ""Conference"" or ""Journal"", populate the appropriate filter object ("Filter conference" or "Filter journal") with the extracted criteria:
        *   **Arrays:** Use arrays for properties that can have multiple values (e.g., "Topics", "Country", "Rank").
        *   **Enums:** Ensure that enum values (e.g., "Type", "Rank", "Continent") are chosen from the allowed list.
        *   **Dates:** Represent date ranges using the ""Conference dates"", ""Submission date"", etc. properties as strings.
        *   **Irrelevant parameters:** Only include what has been specified by the user. If the values do not apply to the filters then *do not include them*.

7.  **Website Navigation ("Redirect"):**
    *   If the "Intent" is "Website navigation", populate the "Redirect" object.
    *   **Allowed Internal Paths:** Redirection to *internal website pages* is **ONLY** permitted for the following exact paths:
        *   /conferences
        *   /dashboard
        *   /journals
        *   /chatbot
        *   /visualization
        *   /chatbot/chat
        *   /chatbot/livechat
        *   /support
        *   /other
        *   /addconference
        *   /conferences/detail
        *   /journals/detail
        *   /auth/login
        *   /auth/register
        *   /updateconference
    *   **Processing Navigation Request:**
        *   Determine the user's intended destination type (Internal website, External Conference site, External Journal site).
        *   **If Internal:** Identify the specific internal path requested (e.g., from "go to dashboard", infer /dashboard).
            *   Check if the inferred path **exactly matches** one of the **Allowed Internal Paths**.
                *   **Match Found:** Set Type to "Internal website" and Value to the matched path (e.g., "/dashboard"). Provide a confirmation Message.
                *   **No Match:** Set Type to "Invalid", set Value to null. Provide a Message explaining that navigation to that *specific internal page* is not supported or recognized. Suggest allowed pages if relevant.
        *   **If External (Conference/Journal website):** Set Type to "Conference website" or "Journal website". Attempt to determine the external URL and set it as the Value. If a specific external URL cannot be reliably determined (e.g., user asks "go to the website for the AI conference" without specifying which one), set Type to "Invalid", Value to null, and explain the ambiguity in the Message.
        *   **If Ambiguous/Impossible:** If the target cannot be determined, is inherently vague ("go to details" without specifying conference or journal), or asks for impossible navigation, set Type to "Invalid", Value to null, and explain why in the Message.
    *   **Message:** A user-friendly Message explaining the outcome (successful redirection path, reason for failure/invalidity) is **always required** within the "Redirect" object.
    * 
8.  **Context Maintenance:**

    *   Remember the context from previous turns in the conversation.
    *   If the user provides new criteria, *replace* the old values with the new ones, *unless* the user is explicitly adding to existing criteria.
    *   If the user expresses a new "Intent", reset the context and start with the new "Intent".
    *   Always try to assume the context is related, unless the previous intent is specifically about an error, or the about is invalid, then reset.

9.  **Description:**
    *   Always provide a concise and accurate "Description" of the user's request and the actions the system will take.
    *   Be specific, but not overly verbose.

**Style (S):**

*   Be accurate and precise in your JSON formatting. Adhere strictly to the provided examples and schema.
*   Be clear and concise in your descriptions.
*   Prioritize clarity and usability over creative writing.

**JSON output Schema:**

{
  "type": "object",
  "properties": {
    "Intent": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "No intent",
          "Find information",
          "Draw chart",
          "Website navigation",
          "Invalid"
        ]
      }
    },
    "About": {
      "type": "string",
      "enum": [
        "Conference",
        "Journal",
        "Website",
        "Invalid"
      ]
    },
    "Filter conference": {
      "type": "object",
      "properties": {
        "Topics": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "Country": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "ConferencesNameList": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "ConferencesAcronymList": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "Type": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "Hybrid",
              "Offline",
              "Online"
            ]
          }
        },
        "Rank": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "A*",
              "A",
              "B",
              "C",
              "National",
              "Regional",
              "Unranked"
            ]
          }
        },
        "Continent": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "Asia",
              "Africa",
              "North America",
              "South America",
              "Oceania",
              "Europe"
            ]
          }
        },
        "Conference dates": {
          "type": "string"
        },
        "Submision date": {
          "type": "string"
        },
        "Notification date": {
          "type": "string"
        },
        "Camera-ready date": {
          "type": "string"
        },
        "Registration date": {
          "type": "string"
        }
      }
    },
    "Filter journal": {
      "type": "object",
      "properties": {
        "Rank": {
          "type": "array",
          "items": {
            "type": "number"
          }
        },
        "Title": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "Issn": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "SJR": {
          "type": "array",
          "items": {
            "type": "number"
          }
        },
        "SJR Best Quartile": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "H index": {
          "type": "number"
        },
        "Country": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "Region": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "Publisher": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "Areas": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "Categories": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "Overton": {
          "type": "array",
          "items": {
            "type": "number"
          }
        },
        "SDG": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "Redirect": {
      "type": "object",
      "properties": {
        "Type": {
          "type": "string",
          "enum": [
            "Internal website",
            "Conference website",
            "Journal website",
            "Invalid"
          ]
        },
        "Value": {
          "type": "string"
        },
        "Message": {
          "type": "string"
        }
      },
      "required": [
        "Type",
        "Message"
      ]
    },
    "Description": {
      "type": "string"
    }
  },
  "required": [
    "Intent",
    "Description"
  ]
}
`;

  const model = genAI.getGenerativeModel({
    model: FILTER_MODEL_NAME,
    systemInstruction: systemInstruction
  });

  console.log("determineUserIntent - Model initialized:", FILTER_MODEL_NAME);
  console.log("determineUserIntent - Generation config:", filterGenerationConfig);

  try {

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
      generationConfig: filterGenerationConfig,
    });

    const responseText = result.response.text();
    console.log("Raw response text from model:", responseText);

    try {
      const jsonResult: UserIntent = JSON.parse(responseText);
      console.log("Parsed JSON:", jsonResult);
      return jsonResult;
    } catch (error) {
      console.error("Error parsing JSON:", error);
      console.error("Failed to parse JSON. Raw text was:", responseText);
      return null;
    }
  } catch (error) {
    console.error("Error generating content:", error);
    return null; // Or throw error, depending on your logic
  }
}

export { filterConferences, filterJournals, determineUserIntent };