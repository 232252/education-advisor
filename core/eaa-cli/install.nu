#!/usr/bin/env nu
#================================================================
# Education Advisor AI (EAA) - Nushell 安装脚本 v3.0
#================================================================
# 用法: nu install.nu [--single-agent] [--no-rust] [--prefix PATH] [--data-dir PATH]
#================================================================

use std log

# 参数解析
def main [
    --single-agent  # 单Agent模式（不检查Node.js）
    --no-rust       # 跳过Rust编译
    --prefix: string = ""  # 数据目录路径
    --data-dir: string = ""  # EAA_DATA_DIR 路径
] {
    let project_root = $env.PWD
    let eaa_data_dir = if $data_dir != "" { $data_dir } else { $env.HOME | path join "eaa-data" }
    let data_dir = if $prefix != "" { $prefix } else { $project_root | path join "data" }

    print $"
(ansi blue)==============================================(ansi reset)
   🎓 Education Advisor AI - 自动化安装 (Nushell)
(ansi blue)==============================================(ansi reset)
"

    # 1. 检测系统环境
    print $"\n(ansi blue)[1/6](ansi reset) 检测系统环境..."
    let os = $nu.os-info.name
    let arch = $nu.os-info.arch
    let platform = match $os {
        "linux" => "linux"
        "macos" => "macos"
        "windows" => "windows"
        _ => "unknown"
    }
    let arch_tag = match $arch {
        "x86_64" => "x86_64"
        "aarch64" => "arm64"
        "armv7l" => "armv7"
        _ => "unknown"
    }
    let platform_tag = $"($platform)-($arch_tag)"

    print $"  操作系统: (ansi cyan)($os)(ansi reset)"
    print $"  系统架构: (ansi cyan)($arch)(ansi reset) ($arch_tag)"
    print $"  平台标签: (ansi cyan)($platform_tag)(ansi reset)"
    print $"  EAA数据目录: (ansi cyan)($eaa_data_dir)(ansi reset)"

    # 2. 检查环境依赖
    print $"\n(ansi blue)[2/6](ansi reset) 检查环境依赖..."

    if not $single_agent {
        if (which node | is-empty) {
            print $"(ansi red)错误: 请先安装 Node.js(ansi reset)"
            exit 1
        } else {
            print "  ✅ node"
        }
        if (which npm | is-empty) {
            print $"(ansi red)错误: 请先安装 npm(ansi reset)"
            exit 1
        } else {
            print "  ✅ npm"
        }
    } else {
        print "  ℹ️  单Agent模式，跳过 Node.js 检查"
    }

    if (which python3 | is-empty) {
        print "  ℹ️  python3 未安装（可选）"
    } else {
        print "  ✅ python3"
    }

    # 3. 获取 eaa CLI
    print $"\n(ansi blue)[3/6](ansi reset) 获取 eaa CLI..."

    let eaa_result = get_eaa_cli $project_root $platform_tag $no_rust
    let has_eaa = $eaa_result.has_eaa
    let eaa_bin = $eaa_result.bin

    if not $has_eaa {
        print $"(ansi yellow)⚠️  eaa CLI 不可用。系统将使用文件模式管理数据。(ansi reset)"
        print $"(ansi yellow)   您可以稍后手动编译或下载：(ansi reset)"
        print $"(ansi yellow)   - 编译: cd core/eaa-cli && cargo build --release(ansi reset)"
        print $"(ansi yellow)   - 下载: https://github.com/232252/education-advisor/releases(ansi reset)"
    }

    # 4. 初始化数据目录
    print $"\n(ansi blue)[4/6](ansi reset) 初始化数据目录..."

    mkdir ($eaa_data_dir | path join "entities")
    mkdir ($eaa_data_dir | path join "events")
    mkdir ($eaa_data_dir | path join "logs")

    # 复制schema
    let schema_src = $project_root | path join "core/eaa-cli/schema"
    let schema_dst = $eaa_data_dir | path join "schema"
    if ($schema_src | path exists) {
        mkdir $schema_dst
        cp -r $"($schema_src)/*" $schema_dst
        print $"  ✅ Schema已复制到 ($schema_dst)"
    }

    # 创建初始数据文件
    let entities_file = $eaa_data_dir | path join "entities/entities.json"
    let name_index_file = $eaa_data_dir | path join "entities/name_index.json"
    let events_file = $eaa_data_dir | path join "events/events.json"

    if not ($entities_file | path exists) {
        '[]' | save -f $entities_file
    }
    if not ($name_index_file | path exists) {
        '{}' | save -f $name_index_file
    }
    if not ($events_file | path exists) {
        '[]' | save -f $events_file
    }

    # 旧版数据目录
    mkdir ($data_dir | path join "entities")
    mkdir ($data_dir | path join "events")
    mkdir ($data_dir | path join "students")

    print $"(ansi green)  数据目录初始化完成: ($eaa_data_dir)(ansi reset)"

    # 5. 单Agent模式设置
    if $single_agent {
        print $"\n(ansi blue)[5/6](ansi reset) 配置单Agent模式..."
        let workspace = $project_root | path join "workspace"
        mkdir $workspace
        cp ($project_root | path join "single-agent/SOUL.md") ($workspace | path join "SOUL.md")
        cp ($project_root | path join "single-agent/USER.md") ($workspace | path join "USER.md")
        print "  ✅ 单Agent文件已复制到 workspace/"
        print $"  (ansi yellow)  请编辑 workspace/USER.md 填写您的信息(ansi reset)"
    } else {
        print $"\n(ansi blue)[5/6](ansi reset) 跳过单Agent配置（多Agent模式）"
    }

    # 6. 验证和完成
    print $"\n(ansi blue)[6/6](ansi reset) 验证安装..."

    if $has_eaa and ($eaa_bin | is-not-empty) {
        # 创建wrapper脚本
        let wrapper_path = "/usr/local/bin/eaa"
        let wrapper_content = $"#!/usr/bin/env nu
# EAA CLI wrapper
let-env EAA_DATA_DIR = '($eaa_data_dir)'
extern run [...args: string] { }
run $'($eaa_bin)' ...$args
"

        try {
            $wrapper_content | save -f $wrapper_path
            chmod +x $wrapper_path
            print $"  ✅ 全局命令已创建: ($wrapper_path)"
        } catch {
            # fallback: 本地wrapper
            let local_wrapper = $project_root | path join "eaa"
            $wrapper_content | save -f $local_wrapper
            chmod +x $local_wrapper
            print $"  ✅ 本地命令已创建: ($local_wrapper)"
            print $"  (ansi yellow)  （无 /usr/local/bin 写入权限，请手动添加到 PATH）(ansi reset)"
        }

        # 设置环境变量到shell配置
        let bashrc = $env.HOME | path join ".bashrc"
        if ($bashrc | path exists) {
            let content = open $bashrc
            if not ($content | str contains "EAA_DATA_DIR") {
                $"export EAA_DATA_DIR=\"($eaa_data_dir)\"\n" | save -a $bashrc
                print "  ✅ EAA_DATA_DIR 已添加到 ~/.bashrc"
            }
        }

        # 验证eaa CLI
        $env.EAA_DATA_DIR = $eaa_data_dir
        try {
            let info = ^$eaa_bin info | complete
            if $info.exit_code == 0 {
                print "  ✅ eaa CLI 验证通过"
            } else {
                print "  ⚠️  eaa CLI 运行异常"
            }
        } catch {
            print "  ⚠️  eaa CLI 运行异常，请检查配置"
        }
    }

    print $"\n(ansi green)=============================================="
    print "   🎓 Education Advisor AI 安装完成！"
    print $"==============================================(ansi reset)
"

    if $single_agent {
        print "部署方式:"
        print $"  (ansi cyan)单Agent模式(ansi reset)
"
        print "下一步:"
        print "  1. 编辑 workspace/USER.md 填写您的信息"
        print "  2. 将 workspace/SOUL.md 的内容复制到您的AI助手的系统提示词中"
        print "  3. 开始与AI对话，完成首次配置引导"
        print "
支持的平台: OpenClaw / ChatGPT GPT / Claude Project / Gemini Gems / 其他"
        print "详见: single-agent/DEPLOY.md"
    } else {
        print "部署方式:"
        print $"  (ansi cyan)多Agent模式（OpenClaw）(ansi reset)
"
        print "下一步:"
        print "  1. 配置您的通信通道（飞书/QQ/Discord/Telegram）"
        print "  2. 启动 OpenClaw: openclaw gateway start"
        print "  3. 给 AI 发送任意消息，开始首次配置引导"
    }
}

# 获取eaa CLI的辅助函数
def get_eaa_cli [project_root: string, platform_tag: string, no_rust: bool] -> record<has_eaa: bool, bin: string> {
    # 3a. 检查已编译的
    let compiled = $project_root | path join "core/eaa-cli/target/release/eaa"
    if ($compiled | path exists) {
        print "  ✅ 发现已编译的 eaa CLI"
        return { has_eaa: true, bin: $compiled }
    }

    # 3b. 尝试编译
    if not $no_rust and (which cargo | is-not-empty) {
        print "  🔨 检测到 Rust，开始编译..."
        let eaa_dir = $project_root | path join "core/eaa-cli"
        cd $eaa_dir
        cargo build --release
        print "  ✅ 编译完成"
        return { has_eaa: true, bin: ($eaa_dir | path join "target/release/eaa") }
    }

    # 3c. 尝试下载
    print "  📦 尝试下载预编译二进制..."
    let binary_url = $"https://github.com/232252/education-advisor/releases/latest/download/eaa-($platform_tag)"
    let download_path = $project_root | path join "eaa"

    try {
        http get $binary_url | save -f $download_path
        chmod +x $download_path
        print $"  ✅ 下载成功: ($platform_tag)"
        return { has_eaa: true, bin: $download_path }
    } catch {
        print $"  ⚠️  未找到 ($platform_tag) 的预编译二进制"
        return { has_eaa: false, bin: "" }
    }
}
