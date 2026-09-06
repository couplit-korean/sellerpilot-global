import {externalDetailImportHandler} from "../../../../../../../lib/server-external-detail-import-api";
export const runtime="nodejs";
export const maxDuration=60;
async function handle(request:Request,context:{params:Promise<{id:string}>}){return externalDetailImportHandler(request,(await context.params).id);}
export {handle as GET,handle as POST,handle as PUT};
