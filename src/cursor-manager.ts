import fs from 'fs';
import fs_promise from 'node:fs/promises';

export class CursorManager {
    static cursor?: number;

    static getCursor() {
        if (!this.cursor) {
            try {
                this.cursor = +fs.readFileSync('./cursor', {encoding: 'utf-8'});
            } catch (e) {
                this.cursor = Date.now();
            }
        }
        return this.cursor;
    }

    static saveCursor() {
        this.cursor = Date.now();
        fs_promise.writeFile('./cursor', this.cursor.toString()).then(() => {});
    }
}