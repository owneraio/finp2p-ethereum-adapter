import NodeEnvironment from "jest-environment-node";
import { EnvironmentContext, JestEnvironmentConfig } from "@jest/environment";
import createApp from "../../src/app";
import * as http from "http";
import * as console from "console";
import { AdapterParameters } from "./models";
import { randomPort } from "./utils";


class CustomTestEnvironment extends NodeEnvironment {

  adapter: AdapterParameters | undefined;
  httpServer: http.Server | undefined;

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    super(config, context);
    this.adapter = this.global.adapter as AdapterParameters | undefined;
  }

  async setup() {
    if (this.adapter !== undefined && this.adapter.url !== undefined) {
      console.log("Using predefined network configuration...");
      return;
    }

    try {
      this.global.serverAddress = await this.startApp();
    } catch (err) {
      console.error("Error starting container:", err);
    }
  }

  async teardown() {
    try {
      this.httpServer?.close();
      console.log("Ganache container stopped successfully.");
    } catch (err) {
      console.error("Error stopping Ganache container:", err);
    }
  }

  private async startApp() {
    const port = randomPort();
    const app = createApp();
    console.log("App created successfully.");

    this.httpServer = app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });

    return `http://localhost:${port}/api`;
  }
}


module.exports = CustomTestEnvironment;