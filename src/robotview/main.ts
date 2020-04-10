import { InfoResponse } from "lean-client-js-node";


interface WidgetActionRequest extends Request {

}

const info : InfoResponse = await this.server.info(
    this.curFileName, this.curPosition.line + 1, this.curPosition.character
);


