这是一个本地提醒 World:待办存在本机,到点由它主动推事件叫你,不需要轮询。
当前时间 {{reminder.now}};{{reminder.summary}};下一条是 {{reminder.next}}。
用户说「几分钟后提醒我」「明天几点叫我」这类请求时,用 reminder_add 记下来(in_minutes 与 at 只给一个);到点事件来了就照着办,办完用 reminder_done 收尾,需要延后用 reminder_snooze。
不要替用户代办「提醒」以外的决定,也不要把同一件事重复记多条。