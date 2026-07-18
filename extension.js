const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

const PATCH_OWNER = "xsjk.codex-workspace-filter";
const TARGET = "openai.chatgpt";
const MARK = "/* codex-workspace-filter:begin */";
const BACKUP_SUFFIX = ".codex-workspace-filter.bak";

/*
 * 原来的 BOOTSTRAP 保留在这里，不再使用。
 * 原因：新补丁需要在 Codex 的 extension.js 中额外注入参数包装函数，
 * 因此改为使用下面的 makeBootstrap(helperName) 动态生成注入代码。
 *
const BOOTSTRAP = `${MARK}
(() => {
    const fs = require("fs"), vscode = require("vscode");
    if (vscode.extensions.getExtension("${PATCH_OWNER}")) return;
    const backup = __filename + "${BACKUP_SUFFIX}";
    if (!fs.existsSync(backup)) return;
    fs.copyFileSync(backup, __filename);
    vscode.commands.executeCommand("workbench.action.restartExtensionHost");
})();
/ * codex-workspace-filter:end * /`;
*/

// 注入到 Codex extension.js 中的包装函数名。
const PARAM_WRAPPER = "__codexWorkspaceFilterWithCwd";

/**
 * 生成要插入到 Codex extension.js 顶部的代码。
 *
 * helperName 是从 Codex 压缩代码中找到的“获取当前工作区目录”函数名。
 * 包装函数会在存在工作区目录时给 thread/list 参数增加 cwd，
 * 没有打开工作区时则保持原参数不变。
 */
function makeBootstrap(helperName) {
    return `${MARK}
const ${PARAM_WRAPPER} = (params) => {
    const roots = ${helperName}();
    return roots.length > 0 ? { ...params, cwd: roots } : params;
};
(() => {
    const fs = require("fs"), vscode = require("vscode");
    if (vscode.extensions.getExtension("${PATCH_OWNER}")) return;
    const backup = __filename + "${BACKUP_SUFFIX}";
    if (!fs.existsSync(backup)) return;
    fs.copyFileSync(backup, __filename);
    vscode.commands.executeCommand("workbench.action.restartExtensionHost");
})();
/* codex-workspace-filter:end */`;
}

const IDENTIFIER = "[A-Za-z_$][\\w$]*";

const WORKSPACE_ROOT_HELPER_PATTERN = new RegExp(
    `function (${IDENTIFIER})\\(\\)\\{let t=${IDENTIFIER}\\.workspace\\.workspaceFolders\\?\\.map\\(r=>r\\.uri\\.fsPath\\)\\?\\?\\[\\];return ${IDENTIFIER}\\(\\)\\?t\\.map\\(${IDENTIFIER}\\):t\\}`,
);

const PATCHES = [
    {
        name: "mcp-request thread/list bridge",

        pattern: new RegExp(
            `case"mcp-request":\\{let\\{id:n,method:o,params:i\\}=r\\.request;this\\.pendingMcpRequests\\.set\\(String\\(n\\),e\\),this\\.codexMcpConnection\\.sendRequest\\((${IDENTIFIER}),String\\(n\\),o,i\\);break\\}`,
        ),

        replace: (
            helperName,
            _match,
            transport,
        ) => `case"mcp-request":{let{id:n,method:o,params:i}=r.request;if(o==="thread/list"&&i&&i.cwd==null){let s=${helperName}();s.length>0&&(i={...i,cwd:s})}this.pendingMcpRequests.set(String(n),e),this.codexMcpConnection.sendRequest(${transport},String(n),o,i);break}`,
    },

    /*
     * 以下两个旧补丁保留但停用。
     *
     * 停用原因：它们要求 Codex 压缩后的源码严格保持固定的变量名、
     * 对象字段顺序和 return 表达式结构。Codex 更新后即使功能不变，
     * 只要打包结果稍有变化，正则就会匹配失败。
     *
    {
        name: "native ChatSession provider thread/list",

        pattern: new RegExp(
            `return this\\.codexAppServer\\.sendRequest\\((${IDENTIFIER}),r,"thread/list",\\{limit:50,cursor:null,sortKey:"created_at",modelProviders:e\\?\\[(${IDENTIFIER})\\]:null,archived:!1,sourceKinds:(${IDENTIFIER})\\}\\),n`,
        ),

        replace: (
            helperName,
            _match,
            transport,
            provider,
            sourceKinds,
        ) => `let s=${helperName}(),a={limit:50,cursor:null,sortKey:"created_at",modelProviders:e?[${provider}]:null,archived:!1,sourceKinds:${sourceKinds}};return s.length>0&&(a={...a,cwd:s}),this.codexAppServer.sendRequest(${transport},r,"thread/list",a),n`,
    },

    {
        name: "ConversationPreviewLoader thread/list",

        pattern: new RegExp(
            `o=\\{limit:e,cursor:null,sortKey:"created_at",modelProviders:\\[\\],archived:!1,sourceKinds:(${IDENTIFIER})\\};return this\\.codexMcpConnection\\.sendRequest\\((${IDENTIFIER}),r,"thread/list",o\\),n`,
        ),

        replace: (
            helperName,
            _match,
            sourceKinds,
            transport,
        ) => `o={limit:e,cursor:null,sortKey:"created_at",modelProviders:[],archived:!1,sourceKinds:${sourceKinds}};let a=${helperName}();return a.length>0&&(o={...o,cwd:a}),this.codexMcpConnection.sendRequest(${transport},r,"thread/list",o),n`,
    },
    */
];

/**
 * 从指定左括号开始解析一次函数调用的顶层参数范围。
 *
 * 这里不依赖 Codex 压缩变量名和对象字段顺序，只需要正确跳过：
 * - 圆括号 ()
 * - 方括号 []
 * - 花括号 {}
 * - 字符串 ""、''、``
 */
function parseCallArguments(source, openParen) {
    const args = [];

    let argStart = openParen + 1;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    let quote = null;
    let escaped = false;

    for (let i = openParen + 1; i < source.length; i += 1) {
        const ch = source[i];

        if (quote !== null) {
            if (escaped) {
                escaped = false;
            } else if (ch === "\\") {
                escaped = true;
            } else if (ch === quote) {
                quote = null;
            }

            continue;
        }

        if (ch === '"' || ch === "'" || ch === "`") {
            quote = ch;
            continue;
        }

        if (ch === "(") {
            parenDepth += 1;
        } else if (ch === ")") {
            if (
                parenDepth === 0 &&
                bracketDepth === 0 &&
                braceDepth === 0
            ) {
                args.push({
                    start: argStart,
                    end: i,
                });

                return {
                    args,
                    closeParen: i,
                };
            }

            parenDepth -= 1;
        } else if (ch === "[") {
            bracketDepth += 1;
        } else if (ch === "]") {
            bracketDepth -= 1;
        } else if (ch === "{") {
            braceDepth += 1;
        } else if (ch === "}") {
            braceDepth -= 1;
        } else if (
            ch === "," &&
            parenDepth === 0 &&
            bracketDepth === 0 &&
            braceDepth === 0
        ) {
            args.push({
                start: argStart,
                end: i,
            });

            argStart = i + 1;
        }
    }

    return null;
}

/**
 * 找出形如：
 *
 *     something.sendRequest(..., "thread/list", params)
 *
 * 的调用，并把 params 包装为：
 *
 *     __codexWorkspaceFilterWithCwd(params)
 *
 * 这样不再依赖 params 是对象字面量还是变量，
 * 也不再依赖参数对象内部的字段顺序。
 */
function patchLiteralThreadListCalls(source) {
    const replacements = [];
    const seenParamStarts = new Set();

    const literalPattern = /(["'])thread\/list\1/g;

    let match;

    while ((match = literalPattern.exec(source)) !== null) {
        const literalStart = match.index;

        const sendRequestStart = source.lastIndexOf(
            ".sendRequest(",
            literalStart,
        );

        /*
         * 防止把距离很远、并不属于当前 thread/list 调用的
         * sendRequest 误判为目标。
         */
        if (
            sendRequestStart < 0 ||
            literalStart - sendRequestStart > 2000
        ) {
            continue;
        }

        const openParen = source.indexOf(
            "(",
            sendRequestStart,
        );

        const parsed = parseCallArguments(
            source,
            openParen,
        );

        if (!parsed) {
            continue;
        }

        /*
         * 找到参数列表中内容恰好是 "thread/list"
         * 或 'thread/list' 的参数。
         */
        const methodArgIndex = parsed.args.findIndex(
            ({ start, end }) => {
                return (
                    source
                        .slice(start, end)
                        .trim() === match[0]
                );
            },
        );

        /*
         * thread/list 后面必须还有一个 params 参数。
         */
        if (
            methodArgIndex < 0 ||
            methodArgIndex + 1 >= parsed.args.length
        ) {
            continue;
        }

        const paramsArg =
            parsed.args[methodArgIndex + 1];

        /*
         * 防止同一个参数位置被重复处理。
         */
        if (seenParamStarts.has(paramsArg.start)) {
            continue;
        }

        const original = source.slice(
            paramsArg.start,
            paramsArg.end,
        );

        /*
         * 如果已经包装过，就不再重复包装。
         */
        if (
            original
                .trim()
                .startsWith(`${PARAM_WRAPPER}(`)
        ) {
            continue;
        }

        seenParamStarts.add(paramsArg.start);

        replacements.push({
            start: paramsArg.start,
            end: paramsArg.end,
            text: `${PARAM_WRAPPER}(${original})`,
        });
    }

    /*
     * 必须从后向前替换。
     *
     * 如果从前向后替换，前面的字符串长度变化会导致
     * 后续保存的索引位置失效。
     */
    let patched = source;

    replacements.sort(
        (a, b) => b.start - a.start,
    );

    for (const replacement of replacements) {
        patched =
            patched.slice(0, replacement.start) +
            replacement.text +
            patched.slice(replacement.end);
    }

    return {
        patched,
        count: replacements.length,
    };
}

async function activate() {
    const targetExtension =
        vscode.extensions.getExtension(TARGET);

    if (!targetExtension) {
        vscode.window.showWarningMessage(
            "Codex Workspace Filter could not find the OpenAI Codex extension.",
        );

        return;
    }

    const mainPath = path.join(
        targetExtension.extensionPath,
        "out",
        "extension.js",
    );

    const backupPath =
        `${mainPath}${BACKUP_SUFFIX}`;

    const source = fs.readFileSync(
        mainPath,
        "utf8",
    );

    /*
     * 已经打过补丁时不重复执行。
     */
    if (source.includes(MARK)) {
        return;
    }

    const helperMatch = source.match(
        WORKSPACE_ROOT_HELPER_PATTERN,
    );

    const helperName = helperMatch
        ? helperMatch[1]
        : null;

    let patched = source;

    const missing = helperName
        ? []
        : ["workspace root helper"];

    if (helperName) {
        /*
         * 原来的通用 PATCHES 循环保留在这里，但不再使用。
         *
         * 旧循环会同时执行那两个对完整压缩语句进行严格匹配的补丁，
         * 因此 Codex 更新后容易因为表达式结构变化而失败。
         *
        for (const patch of PATCHES) {
            if (!patch.pattern.test(patched)) {
                missing.push(patch.name);
                continue;
            }

            patched = patched.replace(
                patch.pattern,
                (...args) =>
                    patch.replace(helperName, ...args),
            );
        }
        */

        /*
         * PATCHES 中目前只保留仍需要精确处理的：
         *
         *     mcp-request thread/list bridge
         *
         * 这个调用中的方法名是变量 o，而不是直接写死的
         * "thread/list"，所以不能由后面的通用扫描处理。
         */
        for (const patch of PATCHES) {
            if (!patch.pattern.test(patched)) {
                missing.push(patch.name);
                continue;
            }

            patched = patched.replace(
                patch.pattern,
                (...args) =>
                    patch.replace(
                        helperName,
                        ...args,
                    ),
            );
        }

        /*
         * 对所有方法名直接写成 "thread/list" 的
         * sendRequest 调用统一包装 params 参数。
         */
        const literalResult =
            patchLiteralThreadListCalls(patched);

        patched = literalResult.patched;

        /*
         * 原来的 Codex 结构中至少存在两个直接使用
         * "thread/list" 的调用：
         *
         * 1. native ChatSession provider
         * 2. ConversationPreviewLoader
         *
         * 少于两个时，不直接写入文件，避免只修改一部分。
         */
        if (literalResult.count < 2) {
            missing.push(
                `literal thread/list sendRequest calls ` +
                `(found ${literalResult.count}, expected at least 2)`,
            );
        }
    }

    if (missing.length > 0) {
        vscode.window.showWarningMessage(
            `Codex Workspace Filter did not patch Codex ` +
            `because expected patterns were missing: ` +
            `${missing.join(", ")}`,
        );

        return;
    }

    if (!patched.includes('"use strict";')) {
        vscode.window.showWarningMessage(
            'Codex Workspace Filter did not patch Codex ' +
            'because `"use strict";` was not found.',
        );

        return;
    }

    /*
     * 原来的静态 BOOTSTRAP 注入保留在这里，不再使用：
     *
     * patched = patched.replace(
     *     '"use strict";',
     *     `"use strict";\n\n${BOOTSTRAP}\n`,
     * );
     */

    /*
     * 在 Codex 的 extension.js 顶部注入：
     *
     * 1. thread/list 参数包装函数；
     * 2. Workspace Filter 被卸载后的自动恢复逻辑。
     */
    patched = patched.replace(
        '"use strict";',
        `"use strict";\n\n${makeBootstrap(helperName)}\n`,
    );

    /*
     * 先保存 Codex 原始 extension.js，
     * 再写入修改后的内容。
     */
    fs.writeFileSync(
        backupPath,
        source,
        "utf8",
    );

    fs.writeFileSync(
        mainPath,
        patched,
        "utf8",
    );

    await vscode.commands.executeCommand(
        "workbench.action.restartExtensionHost",
    );
}

module.exports = {
    activate,
};
