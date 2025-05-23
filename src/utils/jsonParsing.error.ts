// src/errors/jsonParsing.error.ts
export class JsonParsingError extends Error {
    public readonly originalText?: string;
    public readonly cleanedText?: string;

    constructor(message: string, originalText?: string, cleanedText?: string) {
        super(message);
        this.name = 'JsonParsingError';
        this.originalText = originalText;
        this.cleanedText = cleanedText;
        Object.setPrototypeOf(this, JsonParsingError.prototype);
    }
}