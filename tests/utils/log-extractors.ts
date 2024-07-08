import console from 'console';
import { Readable } from 'stream';

export class HardhatLogExtractor {
  privateKeys: string[] = [];

  isStarted = false;

  consume(stream: Readable) {
    stream
      .on('data', line => {
        // console.log(line.toString());
        const match = line.match(/Private Key:\s+(0x[a-fA-F0-9]{64})\s+/);
        if (match && match.length > 0) {
          this.privateKeys.push(match[1]);
        }

        if (line.includes('Started HTTP and WebSocket JSON-RPC server at')) {
          // stream.destroy();
          this.isStarted = true;
        }
      })
      .on('err', line => console.error(line))
      .on('end', () => {
        this.isStarted = true;
      });
  }

  async started(): Promise<void> {
    return new Promise((resolve, reject) => {
      const interval = setInterval(() => {
        if (this.isStarted) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });
  }
}

export class GanacheLogExtractor {
  privateKeys: string[] = [];

  isStarted = false;

  consume(stream: Readable) {
    stream
      .on('data', line => {
        // console.log(line.toString());
        const match = line.match(/\((\d)\)\s+0x([a-fA-F0-9]{64})\s+/);
        if (match && match.length > 1) {
          this.privateKeys.push(match[2]);
        }

        if (line.includes('Listening on')) {
          // stream.destroy();
          this.isStarted = true;
        }
      })
      .on('err', line => console.error(line))
      .on('end', () => {
        this.isStarted = true;
      });
  }

  async started(): Promise<void> {
    return new Promise((resolve, reject) => {
      const interval = setInterval(() => {
        if (this.isStarted) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });
  }
}
