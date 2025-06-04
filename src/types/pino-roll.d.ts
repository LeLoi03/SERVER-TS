// src/types/pino-roll.d.ts
declare module 'pino-roll' {
    import { SonicBoom, SonicBoomOpts } from 'sonic-boom';

    type LogFilePath = () => string;

    interface LimitOptions {
        count?: number;
        removeOtherLogFiles?: boolean;
    }

    type Frequency = 'daily' | 'hourly' | 'custom' | number; // 'custom' có thể không được hỗ trợ trực tiếp, số là ms

    interface PinoRollOptionsBase {
        file: string | LogFilePath;
        size?: string | number;
        frequency?: Frequency;
        extension?: string;
        symlink?: boolean;
        limit?: LimitOptions;
        dateFormat?: string;
        mkdir?: boolean; // Cũng là option của SonicBoom
        outputPath?: string; // Thêm option này nếu bạn muốn thử nghiệm hoặc fork thư viện
    }

    type PinoRollOptions = PinoRollOptionsBase & Omit<SonicBoomOpts, 'dest'>;

    type PinoRollStream = SonicBoom; // pino-roll trả về một SonicBoom stream

    function pinoRoll(options?: PinoRollOptions): Promise<PinoRollStream>; // Hàm là async

    export { PinoRollOptions, PinoRollStream, Frequency, LimitOptions, LogFilePath };
    export default pinoRoll;
}