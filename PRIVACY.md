# 隐私说明

GoBingBing 是一个完全在本地运行的浏览器扩展，没有服务器、账号或遥测。

## 收集的数据

扩展**不收集、不上传**浏览历史、搜索词、设置或任何个人数据。

以下内容仅保存在本机浏览器中：

| 存储位置 | 键 | 内容 | 生命周期 |
| --- | --- | --- | --- |
| chrome.storage.local | settings | 开关、规则、检测与预检选项 | 直到卸载或恢复默认 |
| chrome.storage.local | events | 最近最多 50 条切换 / 中止记录 | 可在弹窗中清空 |
| chrome.storage.local | latency | 来源域名最近延迟（最多 60 条） | 随扩展数据删除 |
| chrome.storage.local | icons | 站点图标字节或 URL（最多 40 条） | 随扩展数据删除 |
| chrome.storage.session | tab:<id> | 单标签页切换链与最后 URL | 浏览器关闭后自动清空 |

## 网络请求

扩展只会在以下情况发起网络请求，请求目标是你在规则中配置的站点：

1. **来源探测**（打开弹窗，默认开启）：对每条启用规则的来源域名请求
   https://<host>/favicon.ico?gbb=...，使用 HEAD、no-cors、禁止缓存。
   请求不携带 Cookie 或凭据。
2. **导航前预检**（默认关闭）：对即将访问的规则来源发 HEAD 请求。
3. **图标加载**：弹窗显示图标时，可能请求站点自身的 favicon，或
   https://icons.duckduckgo.com/ip3/<host>.ico。后者会把域名发送给
   DuckDuckGo；如果不想产生该请求，可保持离线或使用首字母回退（扩展会在
   图标源不可用时自动回退）。
4. **图标字节缓存**（仅在你授予对应站点权限后）：下载 favicon 并保存为
   data URL，以减少后续请求。

扩展不会向开发者或任何分析服务发送数据。

## 权限

- webNavigation：检测主框架加载失败。
- storage：保存上述本地数据。
- notifications：切换 / 中止提醒，可在设置中关闭。
- alarms：定时清除工具栏角标。
- 可选站点权限 https://*/*：仅用于预检和下载图标字节，只有你点击授权时
  才会申请；不授权不影响自动切换与弹窗的来源延迟探测。

## 删除数据

- 在弹窗中点击「清空」可删除最近记录。
- 在设置页点击「恢复默认」会重置设置与规则。
- 卸载扩展会删除 chrome.storage.local 与 chrome.storage.session 中的全部
  扩展数据。

## 联系

如有隐私相关问题，请在
[GitHub Issues](https://github.com/ulyees/GoBingBing/issues) 提出。
