/**
 * lint-eda-api.js
 * EasyEDA Pro 扩展 API 用法检查器
 *
 * 用法:
 *   node scripts/lint-eda-api.js <file.ts> [--json] [--fix-hint]
 *
 * 检查规则:
 *   1. eda.xxx 挂载路径是否存在
 *   2. eda.xxx.method() 方法名是否存在于对应类
 *   2a. 方法调用参数个数是否匹配签名
 *   2b. 枚举类型参数是否传入了正确的枚举类型
 *   3. 枚举名和枚举成员是否合法
 *   4. SCH setState_* 误用检测（SCH 图元不能直接 setState 提交）
 *   5. 已知常见错误模式检测
 */

const fs = require('fs');
const path = require('path');

// ── 加载注册表 ──

const REGISTRY_PATH = path.resolve(__dirname, 'api-registry.json');

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    console.error('[ERROR] api-registry.json not found. Run "node scripts/build-registry.js" first.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
}

// ── 诊断类型 ──

const Severity = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
};

function createDiagnostic(line, col, severity, message, rule, suggestion) {
  return { line, col, severity, message, rule, suggestion: suggestion || null };
}

// ── 检查器 ──

class EdaApiLinter {
  constructor(registry) {
    this.registry = registry;
    this.diagnostics = [];

    // 构建反向映射: className → mountName
    this.classToMount = {};
    for (const [mount, cls] of Object.entries(registry.edaMounts)) {
      this.classToMount[cls] = mount;
    }

    // 构建方法查找表: className → Set<methodName(lowercase)>
    this.classMethodsLower = {};
    for (const [cls, data] of Object.entries(registry.classes)) {
      this.classMethodsLower[cls] = new Set(
        (data.methods || []).map(m => m.key.toLowerCase())
      );
    }

    // 构建 mountName → className 映射
    this.mountToClass = { ...registry.edaMounts };

    // 所有合法的 mount 名（小写用于模糊匹配）
    this.validMounts = new Set(Object.keys(registry.edaMounts));
    this.validMountsLower = {};
    for (const m of this.validMounts) {
      this.validMountsLower[m.toLowerCase()] = m;
    }

    // 枚举名集合
    this.validEnums = new Set(Object.keys(registry.enums));

    // 枚举成员映射: EnumName → Set<MemberName>
    this.enumMembers = {};
    for (const [name, data] of Object.entries(registry.enums)) {
      this.enumMembers[name] = new Set((data.members || []).map(m => m.name));
    }

    // 方法签名解析: className → { methodName(lower) → { minArgs, maxArgs, params: [{ name, type, optional, enumType? }] } }
    this.methodSignatures = {};
    for (const [cls, data] of Object.entries(registry.classes)) {
      const sigMap = {};
      for (const method of (data.methods || [])) {
        if (!method.signature) continue;
        const parsed = this._parseSignature(method.signature);
        if (parsed) {
          sigMap[method.key.toLowerCase()] = parsed;
        }
      }
      this.methodSignatures[cls] = sigMap;
    }
  }

  /** 从 signature 字符串解析参数信息 */
  _parseSignature(sig) {
    // 提取括号内的参数部分: methodName(params): ReturnType
    const parenMatch = sig.match(/\w+\s*\(([^)]*)\)/);
    if (!parenMatch) return null;

    const paramStr = parenMatch[1].trim();
    if (!paramStr) return { minArgs: 0, maxArgs: 0, params: [], returnsPromise: /\)\s*:\s*Promise\b/.test(sig) };

    // 按逗号分割参数（注意泛型中的逗号）
    const params = [];
    let depth = 0;
    let current = '';
    for (const ch of paramStr) {
      if (ch === '<' || ch === '(') depth++;
      else if (ch === '>' || ch === ')') depth--;
      else if (ch === ',' && depth === 0) {
        params.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) params.push(current.trim());

    const parsed = [];
    let minArgs = 0;
    for (const p of params) {
      const optional = p.includes('?');
      // 提取参数名和类型: name?: Type 或 name: Type
      const typeMatch = p.match(/(\w+)\??\s*:\s*(.+)/);
      const paramName = typeMatch ? typeMatch[1] : p.replace('?', '').trim();
      const paramType = typeMatch ? typeMatch[2].trim() : '';
      // 检测枚举类型参数（E 开头的标识符）
      const enumMatch = paramType.match(/^(E[A-Z]\w+)$/);
      parsed.push({
        name: paramName,
        type: paramType,
        optional,
        enumType: enumMatch ? enumMatch[1] : null,
      });
      if (!optional) minArgs++;
    }

    return { minArgs, maxArgs: parsed.length, params: parsed, returnsPromise: /\)\s*:\s*Promise\b/.test(sig) };
  }

  lint(source, filePath) {
    this.diagnostics = [];
    this.filePath = filePath || '<stdin>';
    const lines = source.split('\n');

    // 全文级检查：未定义函数调用
    this._checkUndefinedFunctions(source, lines);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      this._checkEdaMountAccess(line, lineNum);
      this._checkEdaMethodCall(line, lineNum);
      this._checkEnumUsage(line, lineNum);
      this._checkSchSetStateMisuse(line, lineNum, lines, i);
      this._checkCommonPitfalls(line, lineNum);
    }

    return this.diagnostics;
  }

  /** 规则1: eda.xxx 挂载路径检查 */
  _checkEdaMountAccess(line, lineNum) {
    // 匹配 eda.someProperty (不在注释或字符串中的简单检查)
    const regex = /\beda\.(\w+)/g;
    let m;
    while ((m = regex.exec(line)) !== null) {
      const mountName = m[1];
      const col = m.index + 5; // eda. 后的位置

      if (!this.validMounts.has(mountName)) {
        // 尝试模糊匹配
        const suggestion = this._findClosestMount(mountName);
        this.diagnostics.push(createDiagnostic(
          lineNum, col, Severity.ERROR,
          `eda.${mountName} 不存在，EDA 类上没有 "${mountName}" 属性`,
          'invalid-mount',
          suggestion ? `你是否想用 eda.${suggestion}？` : null
        ));
      }
    }
  }

  /** 规则2: eda.xxx.method() 方法调用检查 + 传参检查 */
  _checkEdaMethodCall(line, lineNum) {
    // 匹配 eda.mount.method( 或 eda.mount.property
    const regex = /\beda\.(\w+)\.(\w+)\s*\(/g;
    let m;
    while ((m = regex.exec(line)) !== null) {
      const mountName = m[1];
      const methodName = m[2];
      const col = m.index;

      // 先检查 mount 是否合法（规则1已覆盖，这里只检查方法）
      if (!this.validMounts.has(mountName)) continue;

      const className = this.mountToClass[mountName];
      if (!className) continue;

      const classData = this.registry.classes[className];
      if (!classData) continue;

      const methodsLower = this.classMethodsLower[className];
      if (!methodsLower) continue;

      if (!methodsLower.has(methodName.toLowerCase())) {
        let msg = `${className} 类上不存在方法 "${methodName}"`;
        let hint = null;
        // 仅在同类内模糊匹配，不跨类提示
        const closest = this._findClosestMethod(className, methodName);
        if (closest) {
          hint = `你是否想用 "${closest}"？`;
        }
        this.diagnostics.push(createDiagnostic(
          lineNum, col, Severity.ERROR, msg, 'invalid-method', hint
        ));
        continue;
      }

      // ── 传参检查 ──
      const sigInfo = (this.methodSignatures[className] || {})[methodName.toLowerCase()];
      if (!sigInfo) continue;

      // 提取调用处的实参列表
      const argsStr = this._extractCallArgs(line, m.index + m[0].length - 1);
      if (argsStr === null) continue; // 跨行调用，跳过

      const argList = this._splitArgs(argsStr);
      const argCount = (argList.length === 1 && argList[0].trim() === '') ? 0 : argList.length;

      // 规则2a: 参数个数检查
      if (argCount < sigInfo.minArgs) {
        const sigDisplay = sigInfo.params.map(p => p.optional ? `${p.name}?` : p.name).join(', ');
        this.diagnostics.push(createDiagnostic(
          lineNum, col, Severity.ERROR,
          `${className}.${methodName}() 需要至少 ${sigInfo.minArgs} 个参数，实际传入 ${argCount} 个`,
          'param-count-mismatch',
          `签名: ${methodName}(${sigDisplay})`
        ));
      } else if (argCount > sigInfo.maxArgs) {
        const sigDisplay = sigInfo.params.map(p => p.optional ? `${p.name}?` : p.name).join(', ');
        this.diagnostics.push(createDiagnostic(
          lineNum, col, Severity.WARNING,
          `${className}.${methodName}() 最多接受 ${sigInfo.maxArgs} 个参数，实际传入 ${argCount} 个`,
          'param-count-mismatch',
          `签名: ${methodName}(${sigDisplay})`
        ));
      }

      // 规则2b: 枚举类型参数检查
      // 规则2c: 基础类型不匹配检查
      for (let i = 0; i < Math.min(argCount, sigInfo.params.length); i++) {
        const paramDef = sigInfo.params[i];
        const argValue = argList[i].trim();
        if (!argValue) continue;

        // 2b: 枚举类型参数检查
        if (paramDef.enumType) {
          const enumUsage = argValue.match(/^(E\w+_\w+)\.(\w+)$/);
          if (enumUsage) {
            const usedEnum = enumUsage[1];
            if (usedEnum !== paramDef.enumType) {
              this.diagnostics.push(createDiagnostic(
                lineNum, col, Severity.WARNING,
                `${className}.${methodName}() 第 ${i + 1} 个参数 "${paramDef.name}" 期望枚举类型 ${paramDef.enumType}，实际传入 ${usedEnum}`,
                'param-enum-type',
                `应使用 ${paramDef.enumType}.xxx`
              ));
            }
          }
          else if (/^['"]/.test(argValue) && this.validEnums.has(paramDef.enumType)) {
            this.diagnostics.push(createDiagnostic(
              lineNum, col, Severity.WARNING,
              `${className}.${methodName}() 第 ${i + 1} 个参数 "${paramDef.name}" 期望枚举类型 ${paramDef.enumType}，不建议传入字符串字面量`,
              'param-enum-type',
              `应使用 ${paramDef.enumType}.xxx 而非字符串`
            ));
          }
          continue;
        }

        // 2c: 基础类型不匹配检查（仅对字面量值做静态检测）
        const baseType = paramDef.type.toLowerCase().replace(/\s/g, '');
        // 跳过联合类型、泛型、复杂类型
        if (!baseType || /[|<&]/.test(baseType) || baseType === 'any' || baseType === 'unknown') continue;

        const isStringLiteral = /^['"`]/.test(argValue);
        const isNumberLiteral = /^-?\d+(\.\d+)?$/.test(argValue);
        const isBooleanLiteral = /^(true|false)$/.test(argValue);
        const isArrayLiteral = /^\[/.test(argValue);

        // 期望 string，传入数字字面量
        if (baseType === 'string' && isNumberLiteral) {
          this.diagnostics.push(createDiagnostic(
            lineNum, col, Severity.WARNING,
            `${className}.${methodName}() 第 ${i + 1} 个参数 "${paramDef.name}" 期望 string 类型，实际传入数字 ${argValue}`,
            'param-type-mismatch',
            `应传入字符串，如 "${argValue}"`
          ));
        }
        // 期望 string，传入布尔字面量
        else if (baseType === 'string' && isBooleanLiteral) {
          this.diagnostics.push(createDiagnostic(
            lineNum, col, Severity.WARNING,
            `${className}.${methodName}() 第 ${i + 1} 个参数 "${paramDef.name}" 期望 string 类型，实际传入 boolean ${argValue}`,
            'param-type-mismatch',
            `应传入字符串`
          ));
        }
        // 期望 number，传入字符串字面量
        else if (baseType === 'number' && isStringLiteral) {
          this.diagnostics.push(createDiagnostic(
            lineNum, col, Severity.WARNING,
            `${className}.${methodName}() 第 ${i + 1} 个参数 "${paramDef.name}" 期望 number 类型，实际传入字符串`,
            'param-type-mismatch',
            `应传入数字`
          ));
        }
        // 期望 number，传入布尔字面量
        else if (baseType === 'number' && isBooleanLiteral) {
          this.diagnostics.push(createDiagnostic(
            lineNum, col, Severity.WARNING,
            `${className}.${methodName}() 第 ${i + 1} 个参数 "${paramDef.name}" 期望 number 类型，实际传入 boolean ${argValue}`,
            'param-type-mismatch',
            `应传入数字`
          ));
        }
        // 期望 boolean，传入字符串字面量
        else if (baseType === 'boolean' && isStringLiteral) {
          this.diagnostics.push(createDiagnostic(
            lineNum, col, Severity.WARNING,
            `${className}.${methodName}() 第 ${i + 1} 个参数 "${paramDef.name}" 期望 boolean 类型，实际传入字符串`,
            'param-type-mismatch',
            `应传入 true 或 false`
          ));
        }
        // 期望 boolean，传入数字字面量
        else if (baseType === 'boolean' && isNumberLiteral) {
          this.diagnostics.push(createDiagnostic(
            lineNum, col, Severity.WARNING,
            `${className}.${methodName}() 第 ${i + 1} 个参数 "${paramDef.name}" 期望 boolean 类型，实际传入数字 ${argValue}`,
            'param-type-mismatch',
            `应传入 true 或 false`
          ));
        }
        // 期望 string/number/boolean 但传入数组字面量
        else if (/^(string|number|boolean)$/.test(baseType) && isArrayLiteral) {
          this.diagnostics.push(createDiagnostic(
            lineNum, col, Severity.WARNING,
            `${className}.${methodName}() 第 ${i + 1} 个参数 "${paramDef.name}" 期望 ${paramDef.type} 类型，实际传入数组`,
            'param-type-mismatch',
            `应传入 ${paramDef.type} 类型的值`
          ));
        }
      }

      // 规则2d: 返回 Promise 的方法缺少 await / .then() 检查
      if (sigInfo.returnsPromise) {
        const beforeCall = line.substring(0, m.index);
        const afterCall = line.substring(m.index + m[0].length);
        const hasAwait = /\bawait\s+$/.test(beforeCall) || /\bawait\s+/.test(beforeCall.split(/[;=(,]/).pop());
        const hasThen = /\)\s*\.then\s*\(/.test(afterCall) || /\)\s*\.catch\s*\(/.test(afterCall);
        const isReturned = /\breturn\s+$/.test(beforeCall.trimEnd()) || /\breturn\s+/.test(beforeCall.split(/[;=(,]/).pop());
        if (!hasAwait && !hasThen && !isReturned) {
          this.diagnostics.push(createDiagnostic(
            lineNum, col, Severity.WARNING,
            `${className}.${methodName}() 返回 Promise，但未使用 await 或 .then() 处理`,
            'missing-await',
            `添加 await 或使用 .then() 处理异步结果`
          ));
        }
      }
    }
  }

  /** 规则3: 枚举使用检查 */
  _checkEnumUsage(line, lineNum) {
    // 匹配 EXXX_YyyZzz.MEMBER
    const regex = /\b(E\w+_\w+)\.(\w+)/g;
    let m;
    while ((m = regex.exec(line)) !== null) {
      const enumName = m[1];
      const memberName = m[2];
      const col = m.index;

      if (!this.validEnums.has(enumName)) {
        // 枚举名不存在
        const closest = this._findClosestEnum(enumName);
        this.diagnostics.push(createDiagnostic(
          lineNum, col, Severity.ERROR,
          `枚举 "${enumName}" 不存在`,
          'invalid-enum',
          closest ? `你是否想用 "${closest}"？` : null
        ));
        continue;
      }

      const members = this.enumMembers[enumName];
      if (members && !members.has(memberName)) {
        const validList = [...members].slice(0, 5).join(', ');
        this.diagnostics.push(createDiagnostic(
          lineNum, col, Severity.ERROR,
          `枚举 ${enumName} 中不存在成员 "${memberName}"`,
          'invalid-enum-member',
          `可用成员: ${validList}${members.size > 5 ? '...' : ''}`
        ));
      }
    }
  }

  /** 规则4: SCH setState_* 误用检测 */
  _checkSchSetStateMisuse(line, lineNum, lines, idx) {
    // 检测 SCH 图元对象直接调用 setState_* 而没有用 modify()
    // 模式: sch 相关变量.setState_Xxx(...)
    const setStateMatch = line.match(/\.setState_(\w+)\s*\(/);
    if (!setStateMatch) return;

    // 向上查找是否有 sch_ 相关的上下文
    const context = lines.slice(Math.max(0, idx - 10), idx + 1).join('\n');
    const isSchContext = /\beda\.sch_\w+/.test(context) ||
                         /\bISCH_\w+/.test(context) ||
                         /\bsch_Primitive\w+/.test(context);

    // 检查是否有 .done() 调用（PCB 模式）
    const hasDone = /\.done\s*\(\s*\)/.test(line) ||
                    (idx + 1 < lines.length && /\.done\s*\(\s*\)/.test(lines[idx + 1]));

    if (isSchContext && !hasDone) {
      this.diagnostics.push(createDiagnostic(
        lineNum, setStateMatch.index, Severity.WARNING,
        `SCH 图元的 setState_* 不会直接提交变更，需要使用对应类的 modify() 方法`,
        'sch-setstate-misuse',
        `SCH 中应使用 eda.sch_PrimitiveXxx.modify(id, { ... }) 来修改属性`
      ));
    }
  }

  /** 规则5: 常见错误模式检测 */
  _checkCommonPitfalls(line, lineNum) {
    // 5a: eda.sch_Document.getCurrentDocumentInfo() 错误
    if (/\beda\.sch_Document\.getCurrentDocumentInfo\b/.test(line)) {
      this.diagnostics.push(createDiagnostic(
        lineNum, 0, Severity.ERROR,
        `getCurrentDocumentInfo 不在 SCH_Document 上`,
        'wrong-class-mount',
        `应使用 eda.dmt_SelectControl.getCurrentDocumentInfo()`
      ));
    }

    // 5b: docInfo.type 而非 docInfo.documentType
    if (/\bdocInfo\.type\b/.test(line) || /\.type\s*===?\s*EDMT_EditorDocumentType/.test(line)) {
      this.diagnostics.push(createDiagnostic(
        lineNum, 0, Severity.WARNING,
        `文档类型属性应使用 documentType 而非 type`,
        'wrong-property-name',
        `使用 docInfo.documentType`
      ));
    }

    // 5c: window.parent.eda 或 window.eda
    if (/\bwindow\.(parent\.)?eda\b/.test(line)) {
      this.diagnostics.push(createDiagnostic(
        lineNum, 0, Severity.WARNING,
        `不支持通过 window 访问 eda，直接使用 eda 即可`,
        'unnecessary-window-eda',
        `将 window.eda / window.parent.eda 替换为 eda`
      ));
    }

    // 5d: (window as any).__xxx 跨进程传数据
    if (/\(window\s+as\s+any\)\.__\w+/.test(line)) {
      this.diagnostics.push(createDiagnostic(
        lineNum, 0, Severity.WARNING,
        `主进程和 iframe 的 window 对象是隔离的，不能通过 window.__xxx 传数据`,
        'isolated-window',
        `使用 eda.sys_Storage.setExtensionUserConfig() 或直接在 iframe 中调用 eda API`
      ));
    }

    // 5e: console.log 在生产代码中
    if (/\bconsole\.log\s*\(/.test(line)) {
      this.diagnostics.push(createDiagnostic(
        lineNum, 0, Severity.INFO,
        `生产代码中不建议使用 console.log，请使用 console.warn 或 console.error`,
        'no-console-log',
        null
      ));
    }

    // 5f: openIFrame 带查询参数
    if (/openIFrame\s*\([^)]*\?[^)]*\)/.test(line)) {
      this.diagnostics.push(createDiagnostic(
        lineNum, 0, Severity.ERROR,
        `openIFrame 的路径不允许包含查询参数`,
        'iframe-query-params',
        `移除 URL 中的 ? 查询参数`
      ));
    }

    // 5g: getExtensionUserConfig() 不传 key
    if (/getExtensionUserConfig\s*\(\s*\)/.test(line)) {
      this.diagnostics.push(createDiagnostic(
        lineNum, 0, Severity.ERROR,
        `getExtensionUserConfig() 必须传入 key 参数，否则返回 undefined`,
        'storage-missing-key',
        `使用 getExtensionUserConfig('yourKey')`
      ));
    }

    // 5h: SCH_Primitive / PCB_Primitive 直接调用 getAllPrimitiveId
    if (/\beda\.(sch_Primitive|pcb_Primitive)\.getAllPrimitiveId\b/.test(line)) {
      this.diagnostics.push(createDiagnostic(
        lineNum, 0, Severity.ERROR,
        `SCH_Primitive / PCB_Primitive 是抽象类，没有 getAllPrimitiveId 方法`,
        'abstract-class-method',
        `使用具体的图元类，如 eda.sch_PrimitiveComponent.getAllPrimitiveId()`
      ));
    }
  }

  /** 规则6: 未定义函数调用检测 */
  _checkUndefinedFunctions(source, lines) {
    // 收集当前文件中定义的函数名
    const defined = new Set();

    // function xxx(
    const funcDeclRegex = /\bfunction\s+(\w+)\s*\(/g;
    let m;
    while ((m = funcDeclRegex.exec(source)) !== null) defined.add(m[1]);

    // const/let/var xxx = (  或 const/let/var xxx = async (
    const arrowRegex = /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/g;
    while ((m = arrowRegex.exec(source)) !== null) defined.add(m[1]);

    // const/let/var xxx = async? function
    const funcExprRegex = /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function/g;
    while ((m = funcExprRegex.exec(source)) !== null) defined.add(m[1]);

    // class xxx
    const classRegex = /\bclass\s+(\w+)/g;
    while ((m = classRegex.exec(source)) !== null) defined.add(m[1]);

    // import 的名称
    const importRegex = /\bimport\s+(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+))/g;
    while ((m = importRegex.exec(source)) !== null) {
      if (m[1]) m[1].split(',').forEach(s => defined.add(s.trim().split(/\s+as\s+/).pop().trim()));
      if (m[2]) defined.add(m[2]);
      if (m[3]) defined.add(m[3]);
    }

    // 方法参数中的解构和回调参数不追踪，只做顶层函数调用检测
    // 内置全局对象和常见 API 白名单
    const builtins = new Set([
      'eda', 'console', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
      'Promise', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Math', 'JSON',
      'Date', 'RegExp', 'Map', 'Set', 'Error', 'TypeError', 'parseInt', 'parseFloat',
      'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'fetch',
      'require', 'module', 'exports', 'alert', 'confirm', 'prompt',
      'document', 'window', 'navigator', 'location', 'history',
      'crypto', 'performance', 'queueMicrotask', 'structuredClone',
      'Blob', 'File', 'FileReader', 'URL', 'URLSearchParams',
      'TextEncoder', 'TextDecoder', 'AbortController', 'FormData',
      'requestAnimationFrame', 'cancelAnimationFrame',
      'addEventListener', 'removeEventListener',
      'Symbol', 'Proxy', 'Reflect', 'WeakMap', 'WeakSet', 'BigInt',
      'Intl', 'globalThis', 'atob', 'btoa',
    ]);

    // 扫描独立函数调用: xxx( 但不是 .xxx( 也不是定义
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 跳过注释行
      if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;

      const callRegex = /(?<![.\w])(\b[a-zA-Z_]\w*)\s*\(/g;
      let cm;
      while ((cm = callRegex.exec(line)) !== null) {
        const name = cm[1];
        // 跳过关键字
        if (/^(if|else|for|while|switch|catch|return|throw|new|typeof|instanceof|await|async|export|import|from|function|class|const|let|var|try|finally|do|case|break|continue|default|void|delete|in|of|yield|super|this|extends|implements|interface|type|enum|declare|abstract|as|is|keyof|readonly|never|unknown|any|undefined|null|true|false)$/.test(name)) continue;
        // 跳过已定义的和内置的
        if (defined.has(name) || builtins.has(name)) continue;
        // 跳过枚举名（E 开头的大写标识符）
        if (/^E[A-Z]/.test(name)) continue;
        // 跳过类型断言和泛型中的标识符
        if (/^\s*</.test(line.substring(cm.index + cm[0].length))) continue;

        this.diagnostics.push(createDiagnostic(
          i + 1, cm.index, Severity.WARNING,
          `"${name}" 未在当前文件中定义或导入，可能是未定义的函数调用`,
          'undefined-function',
          `确认 "${name}" 是否已被删除或需要 import`
        ));
      }
    }
  }

  // ── 参数提取辅助 ──

  /** 从调用处的左括号位置提取括号内的参数字符串，返回 null 表示跨行 */
  _extractCallArgs(line, openParenIdx) {
    let depth = 0;
    let start = openParenIdx;
    for (let i = openParenIdx; i < line.length; i++) {
      const ch = line[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          return line.substring(start + 1, i);
        }
      }
    }
    return null; // 括号未闭合（跨行调用）
  }

  /** 按顶层逗号分割参数字符串 */
  _splitArgs(argsStr) {
    const args = [];
    let depth = 0;
    let current = '';
    for (const ch of argsStr) {
      if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth++;
      else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth--;
      else if (ch === ',' && depth === 0) {
        args.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    args.push(current);
    return args;
  }

  // ── 模糊匹配辅助 ──

  _findClosestMount(name) {
    const lower = name.toLowerCase();
    // 精确小写匹配
    if (this.validMountsLower[lower]) return this.validMountsLower[lower];
    // Levenshtein 距离
    let best = null, bestDist = Infinity;
    for (const m of this.validMounts) {
      const d = levenshtein(lower, m.toLowerCase());
      if (d < bestDist && d <= 3) { bestDist = d; best = m; }
    }
    return best;
  }

  _findClosestMethod(className, methodName) {
    const methods = this.classMethodsLower[className];
    if (!methods) return null;
    const lower = methodName.toLowerCase();
    let best = null, bestDist = Infinity;
    for (const m of methods) {
      const d = levenshtein(lower, m);
      if (d < bestDist && d <= 3) { bestDist = d; best = m; }
    }
    // 返回原始大小写的方法名
    if (best) {
      const classData = this.registry.classes[className];
      const found = (classData.methods || []).find(m => m.key.toLowerCase() === best);
      return found ? found.name : best;
    }
    return null;
  }

  _findMethodInOtherClass(methodName) {
    const lower = methodName.toLowerCase();
    for (const [cls, methods] of Object.entries(this.classMethodsLower)) {
      if (methods.has(lower)) {
        const mount = this.classToMount[cls];
        if (mount) return { className: cls, mount };
      }
    }
    return null;
  }

  _findClosestEnum(name) {
    let best = null, bestDist = Infinity;
    for (const e of this.validEnums) {
      const d = levenshtein(name.toLowerCase(), e.toLowerCase());
      if (d < bestDist && d <= 4) { bestDist = d; best = e; }
    }
    return best;
  }
}

// ── Levenshtein 距离 ──

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ── 输出格式化 ──

function formatDiagnostics(diagnostics, filePath) {
  if (diagnostics.length === 0) {
    return `[PASS] ${filePath}: 未发现 EDA API 使用问题`;
  }

  const errors = diagnostics.filter(d => d.severity === Severity.ERROR);
  const warnings = diagnostics.filter(d => d.severity === Severity.WARNING);
  const infos = diagnostics.filter(d => d.severity === Severity.INFO);

  const lines = [`\n[REPORT] ${filePath}: ${diagnostics.length} 个问题 (${errors.length} 错误, ${warnings.length} 警告, ${infos.length} 提示)\n`];

  const icons = { error: '[ERROR]', warning: '[WARN]', info: '[INFO]' };

  for (const d of diagnostics) {
    lines.push(`  ${icons[d.severity]} L${d.line}:${d.col}  ${d.message}  [${d.rule}]`);
    if (d.suggestion) {
      lines.push(`     [HINT] ${d.suggestion}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ── HTML <script> 提取 ──

/** 从 HTML 中提取所有 <script> 标签的内容及其起始行号 */
function extractScriptsFromHtml(html) {
  const segments = [];
  const regex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const scriptContent = m[1];
    if (!scriptContent.trim()) continue;
    // 计算 <script> 标签所在行号
    const beforeScript = html.substring(0, m.index);
    const lineOffset = beforeScript.split('\n').length;
    segments.push({ source: scriptContent, lineOffset });
  }
  return segments;
}

// ── HTML 标记级检查 ──

/** 检查 HTML 标记中的资源路径等问题（仅 iframe/ 目录下的文件） */
function lintHtmlMarkup(html, filePath) {
  const diagnostics = [];

  // 只检查 iframe/ 目录下的 HTML 文件
  const normalized = filePath.replace(/\\/g, '/');
  if (!/(^|\/)iframe\//.test(normalized)) return diagnostics;

  const lines = html.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // 检查 href/src 使用相对路径 (./ 或 ../)
    const relPathRegex = /(href|src)\s*=\s*["'](\.\.?\/[^"']+)["']/g;
    let relPathMatch;
    while ((relPathMatch = relPathRegex.exec(line)) !== null) {
      const relPath = relPathMatch[2];
      const fileName = relPath.split('/').pop();
      diagnostics.push(createDiagnostic(
        lineNum, relPathMatch.index, Severity.ERROR,
        `iframe 内资源路径不能使用相对路径 "${relPath}"，应使用完整路径`,
        'iframe-relative-path',
        `使用绝对路径，如 /iframe/${fileName}`
      ));
    }
  }

  return diagnostics;
}

// ── 递归扫描目录 ──

/** 递归收集目录下所有 .ts / .html 文件 */
function collectFiles(dir, result) {
  result = result || [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'build' || entry.name === 'dist') continue;
      collectFiles(full, result);
    } else if (/\.(ts|html?)$/i.test(entry.name)) {
      result.push(full);
    }
  }
  return result;
}

/** 将参数列表中的目录展开为文件列表 */
function resolveInputs(inputs) {
  const files = [];
  for (const input of inputs) {
    if (!fs.existsSync(input)) {
      console.error(`路径不存在: ${input}`);
      continue;
    }
    if (fs.statSync(input).isDirectory()) {
      collectFiles(input, files);
    } else {
      files.push(input);
    }
  }
  return files;
}

// ── CLI 入口 ──

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const inputs = args.filter(a => !a.startsWith('--'));

  if (inputs.length === 0) {
    console.log('用法: node lint-eda-api.js <file-or-dir> [...] [--json]');
    console.log('');
    console.log('  传入文件: 检查指定文件');
    console.log('  传入目录: 递归检查目录下所有 .ts / .html 文件');
    console.log('');
    console.log('首次使用前请先运行: node scripts/build-registry.js');
    process.exit(0);
  }

  const files = resolveInputs(inputs);
  if (files.length === 0) {
    console.log('未找到 .ts / .html 文件');
    process.exit(0);
  }

  const registry = loadRegistry();
  const linter = new EdaApiLinter(registry);
  let totalErrors = 0;

  const allResults = {};

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf-8');
    const isHtml = /\.html?$/i.test(file);
    const segments = isHtml ? extractScriptsFromHtml(raw) : [{ source: raw, lineOffset: 0 }];

    let diagnostics = [];

    // HTML 文件：对整个文件做 HTML 级别检查（资源路径等）
    if (isHtml) {
      diagnostics = diagnostics.concat(lintHtmlMarkup(raw, file));
    }

    for (const seg of segments) {
      const d = linter.lint(seg.source, file);
      // 修正行号偏移（HTML 内嵌脚本）
      if (seg.lineOffset > 0) {
        for (const item of d) { item.line += seg.lineOffset; }
      }
      diagnostics = diagnostics.concat(d);
    }
    totalErrors += diagnostics.filter(d => d.severity === Severity.ERROR).length;

    if (jsonMode) {
      allResults[file] = diagnostics;
    } else {
      console.log(formatDiagnostics(diagnostics, file));
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify(allResults, null, 2));
  }

  // 有 error 级别问题时退出码为 1
  process.exit(totalErrors > 0 ? 1 : 0);
}

main();
