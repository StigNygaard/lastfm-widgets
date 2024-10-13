
export function log(params: URLSearchParams, req: Request, info: Deno.ServeHandlerInfo) {
    const origin = req.headers?.get('Origin');
    const type = (params.get('type') ?? 'state').trim().toLowerCase();

    if (req.body) {
        const logObj = {
            date: new Date().toISOString(),
            userAgent: req.headers?.get('User-Agent') ?? '',
            origin: origin ?? '',
            referer: req.headers?.get('Referer') ?? '',
            ...remoteAddr(info)
        };
        req.json().then(obj => {
            console.log(`${type}:`, {...logObj, data: obj});
        }).catch(_error => {
            console.warn(`${type} req.json() log-error:`, logObj);
        });
    }
}

function remoteAddr(info: Deno.ServeHandlerInfo): object {
    if ('hostname' in info.remoteAddr) {
        return {
            remoteIp: info.remoteAddr.hostname,
            remotePort: info.remoteAddr.port
        }
    }
    return {};
}
