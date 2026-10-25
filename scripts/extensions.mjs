// 将本仓库中的扩展文件夹（即含有 extension.json 的文件夹）
// 以 JSON 数组的形式输出，供 CI 构建矩阵使用。
import fs from 'node:fs';

export function extensions(root = '.') {
    return fs
        .readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .filter((entry) => fs.existsSync(`${root}/${entry.name}/extension.json`))
        .map((entry) => entry.name)
        .sort();
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('extensions.mjs')) {
    console.log(JSON.stringify(extensions()));
}
