// src/config/chatbot.config.ts
import { singleton } from 'tsyringe';
import { AppConfig } from './types';
import { AgentId } from '../chatbot/shared/types';

@singleton()
export class ChatbotConfig {
    public readonly allowedSubAgents: AgentId[];
    public readonly maxTurnsHostAgent: number;

    constructor(private appConfig: AppConfig) {
        this.allowedSubAgents = appConfig.ALLOWED_SUB_AGENTS!; // Defaulted in main ConfigService
        this.maxTurnsHostAgent = appConfig.MAX_TURNS_HOST_AGENT;
    }
}