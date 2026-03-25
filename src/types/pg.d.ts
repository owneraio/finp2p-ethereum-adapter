declare module "pg" {
  export class Pool {
    constructor(config: { connectionString: string });
    query(sql: string, params?: any[]): Promise<any>;
  }
}
