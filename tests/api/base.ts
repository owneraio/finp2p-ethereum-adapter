import axios from "axios";

export class ClientBase {
  host: string;

  constructor(host: string) {
    this.host = host;
  }

  async get<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      axios.get(`${this.host}${url}`, {
        headers: {
          "Accept": "application/json"
        }
      }).then(({ data: response }) => {
        resolve(response);
      }).catch((error: Error) => {
        console.log("error", error);
        reject(error.message);
      });
    });
  };

  async post<T>(url: string, data?: any, idempotencyKey?: string): Promise<T> {
    return new Promise((resolve, reject) => {
      axios.post(`${this.host}${url}`, data, {
        headers: {
          "Content-Type": "application/json", "Accept": "application/json", "Idempotency-Key": idempotencyKey
        }
      }).then(({ data: response }) => {
        resolve(response);
      }).catch((error: Error) => {
        console.log("error", error);
        reject(error.message);
      });
    });
  }
}
