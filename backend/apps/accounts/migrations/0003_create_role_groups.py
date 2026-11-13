"""建立角色用的 Django Group(apps/accounts/roles.py 的 GROUP_BACKED_ROLES)。

角色名稱寫死在這裡而不是 import Role:migration 要反映「寫下當時」的狀態,之後 Role 改名
或新增成員時,舊 migration 的行為不能跟著變。新增角色請另寫一支同樣形狀的 migration。
"""

from django.db import migrations

ROLE_GROUPS = ("admin",)


def create_groups(apps, _schema_editor):
    Group = apps.get_model("auth", "Group")
    for name in ROLE_GROUPS:
        Group.objects.get_or_create(name=name)


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0002_lineprofile"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    # reverse 是 noop:不刪 group——回滾時已經被指派的成員關係會跟著消失,資料無法還原。
    operations = [migrations.RunPython(create_groups, migrations.RunPython.noop)]
