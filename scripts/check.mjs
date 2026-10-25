// 按面板接受扩展包之前的检查方式，校验一个已构建的扩展。
// 用法：node scripts/check.mjs <扩展文件夹>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const dir = path.resolve(process.argv[2] ?? '');
const folder = path.basename(dir);
const errors = [];

const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'extension.json'), 'utf8'));
if (manifest.id !== folder) errors.push(`extension.json 中的 id "${manifest.id}" 必须与文件夹名 "${folder}" 一致`);
if (!/^\d+\.\d+\.\d+/.test(manifest.version ?? '')) errors.push('extension.json 需要一个语义化版本号');

const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
if (pkg.version !== manifest.version)
    errors.push(`package.json 的版本 ${pkg.version} 与 extension.json 的 ${manifest.version} 不一致`);

if (manifest.ui?.entry && !fs.existsSync(path.join(dir, manifest.ui.entry))) {
    errors.push(`${manifest.ui.entry} 不存在 —— 请先执行构建`);
}

if (manifest.provider) {
    const [namespace, ...rest] = manifest.provider.split('\\');
    const source = manifest.autoload?.[`${namespace}\\`];
    if (!source || !fs.existsSync(path.join(dir, source, `${rest.join('/')}.php`))) {
        errors.push(`provider ${manifest.provider} 在 autoload 下没有对应的文件`);
    }
}

if (!fs.existsSync(path.join(dir, 'README.md'))) errors.push('缺少 README.md');

// 扩展的样式表在面板样式表之后加载，且与其他所有扩展并列，因此 Tailwind 工具类
// 必须带本扩展自己的前缀（清单中的 ui.prefix），主题变量也必须带对应的 `--<前缀>-`，
// 否则就会覆盖其他人的样式。
const prefix = manifest.ui?.prefix;
const dist = path.join(dir, 'dist');
const stylesheets = fs.existsSync(dist) ? fs.readdirSync(dist).filter((name) => name.endsWith('.css')) : [];
for (const name of stylesheets) {
    const css = fs.readFileSync(path.join(dist, name), 'utf8');
    if (!/@layer\s+(utilities|theme)\b/.test(css)) continue;

    if (!/^[a-z]{2,12}$/.test(prefix ?? '')) {
        errors.push('由于打包了 Tailwind 样式，extension.json 需要 ui.prefix（2-12 个小写字母）');
        continue;
    }

    let postcss;
    try {
        postcss = createRequire(path.join(dir, 'package.json'))('postcss');
    } catch {
        errors.push(`dist/${name} 使用了 Tailwind 分层，但未安装 postcss，无法校验`);
        continue;
    }

    postcss.parse(css).walkAtRules('layer', (layer) => {
        const layerName = layer.params.trim();
        if (layerName === 'utilities') {
            layer.walkRules((rule) => {
                if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
                if (!rule.selector.includes(`.${prefix}\\:`)) {
                    errors.push(`dist/${name}: 工具类 "${rule.selector.slice(0, 60)}" 未使用 ${prefix}: 前缀`);
                }
            });
        }
        if (layerName === 'theme') {
            layer.walkDecls(/^--/, (decl) => {
                if (!decl.prop.startsWith(`--${prefix}-`)) {
                    errors.push(`dist/${name}: 主题变量 ${decl.prop} 未使用 --${prefix}- 前缀`);
                }
            });
        }
    });
}

if (errors.length > 0) {
    console.error(`${folder}: 发现 ${errors.length} 个问题`);
    for (const error of [...new Set(errors)].slice(0, 20)) console.error(`  - ${error}`);
    process.exit(1);
}

console.log(`${folder}: 通过 (v${manifest.version})`);
