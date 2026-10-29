# 训练计时器：本地使用

## 启动网页服务

在 Mac 的终端中执行：

```bash
python3 -m http.server 4173 --bind 0.0.0.0 --directory /Users/harryliu/Documents/workspace/SportTimer
```

保持终端窗口打开，服务就会持续运行。电脑本机可访问 <http://127.0.0.1:4173/>。

## 手机访问

手机和 Mac 连接同一个 Wi-Fi。在 Mac 终端执行以下命令，查看 Wi-Fi 的局域网地址：

```bash
ipconfig getifaddr en0
```

例如输出 `10.0.0.166`，则在手机 Chrome 中打开 `http://10.0.0.166:4173/`。地址可能随网络变化，请以命令的实际输出为准。

若手机打开的是文件列表而不是计时器，请确认启动命令中的 `--directory` 指向项目目录。若无法连接，请检查 Mac 防火墙是否允许 Python 接收传入连接，以及 Wi-Fi 是否启用了设备隔离。通过局域网 HTTP 访问时，离线缓存和屏幕常亮等需要安全连接的功能可能不可用。

## 关闭网页服务

在运行服务的终端窗口按 **Control + C**。

如果服务在其他终端中运行，可先查找占用 4173 端口的进程：

```bash
lsof -nP -iTCP:4173 -sTCP:LISTEN
```

确认输出中的进程是这个网页服务后，使用其中的 PID 关闭：

```bash
kill PID
```

把 `PID` 替换为实际数字。启动时如果提示端口已被占用，也可以用上述命令查找并关闭旧服务。
