#!/usr/bin/env nu
# EAA 卸载脚本 (Nushell版)

def main [] {
    print "卸载 Education Advisor AI..."

    # 移除全局命令
    let wrapper = "/usr/local/bin/eaa"
    if ($wrapper | path exists) {
        rm $wrapper
        print "✅ 已移除 /usr/local/bin/eaa"
    }

    # 清理bashrc中的环境变量
    let bashrc = $env.HOME | path join ".bashrc"
    if ($bashrc | path exists) {
        let content = open $bashrc
        if ($content | str contains "EAA_DATA_DIR") {
            let new_content = $content | lines | where { not ($in | str contains "EAA_DATA_DIR") } | str join "\n"
            $new_content | save -f $bashrc
            print "✅ 已清理 ~/.bashrc 中的环境变量"
        }
    }

    print ""
    print "⚠️ 数据目录保留（如需删除请手动操作）："
    print "  rm -rf ./data"
    print ""
    print "卸载完成。"
}
