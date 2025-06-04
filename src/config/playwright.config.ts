// src/config/playwright.config.ts
import { singleton } from 'tsyringe';
import { AppConfig, PlaywrightConfigStruct } from './types';

@singleton()
export class PlaywrightConfig {
    public readonly channel: string | undefined;
    public readonly headless: boolean;
    public readonly userAgent: string;

    constructor(private appConfig: AppConfig) {
        this.channel = appConfig.PLAYWRIGHT_CHANNEL;
        this.headless = appConfig.PLAYWRIGHT_HEADLESS;
        this.userAgent = appConfig.USER_AGENT;
    }

    public get config(): PlaywrightConfigStruct {
        return {
            channel: this.channel,
            headless: this.headless,
            userAgent: this.userAgent,
        };
    }
}