from django.db import models

from apps.core.models import TimestampedModel


class Holiday(TimestampedModel):
    """預設規則(週一到週五上班、週六日放假)的「例外日」。

    - ``is_holiday=True``:平日放假(國定假日、彈性放假、補假)
    - ``is_holiday=False``:週末補班
    沒有列在這張表的日子照預設規則判斷,所以只要存例外,不必存一整年 365 筆。
    颱風假等臨時停班不在行政院人事行政總處的年度行事曆裡,要的話從後台手動加。
    """

    day = models.DateField(unique=True)
    name = models.CharField(max_length=50, blank=True)
    is_holiday = models.BooleanField(default=True, help_text="勾選 = 這天放假;不勾 = 這天(週末)補班。")

    class Meta:
        ordering = ["day"]

    def __str__(self) -> str:
        kind = "放假" if self.is_holiday else "補班"
        return f"{self.day.isoformat()} {self.name or kind}"
