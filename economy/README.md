# 经济系统

面板的积分账本。余额、流水、幂等和行锁都在这里，其它扩展只依赖 `Economy\Contracts\Wallet`
接口，不各建一张余额表。

## 功能

- 每个用户一个钱包，余额与流水分开存放
- 扣款不会扣成负数，可以按需允许负余额
- `reference` 唯一索引，重试和回调不会重复记账
- 用户页、管理页、Application API 三套接口
- 管理端支持单个调整，也支持勾一批人批量调整

## 数据表

| 表 | 说明 |
| --- | --- |
| `ext_economy_wallets` | 每个用户一行，`balance` 为当前余额，`frozen` 预留给后续功能 |
| `ext_economy_transactions` | 只追加的流水，含 `balance_after`、`kind`、`reference`（唯一） |

## 契约

```php
namespace Economy\Contracts;

interface Wallet
{
    public function balance(User $user): int;
    public function canAfford(User $user, int $amount): bool;
    public function deposit(User $user, int $amount, string $kind, ?string $description = null, ?string $reference = null): array;
    public function withdraw(User $user, int $amount, string $kind, ?string $description = null, ?string $reference = null): array;
    public function transfer(User $from, User $to, int $amount, string $kind, ?string $description = null, ?string $reference = null): void;

    public function history(User $user, int $limit = 50, ?string $kind = null): array;
    public function entry(string $reference): ?array;
    public function summary(User $user): array;
    public function aggregate(): array;
    public function all(int $limit = 100, array $userIds = []): array;
}
```

金额一律为整数。`withdraw` 扣不动抛 `InsufficientBalanceException`；同一个 `reference`
换成别的金额或来源会抛 `InvalidArgumentException`，不会静默记账。`kind` 建议用扩展 id，
例如 `ai-assistant`、`store`、`checkin`。

## 其它扩展怎么接

```php
use Economy\Contracts\Wallet;

$wallet = interface_exists(Wallet::class) ? app(Wallet::class) : null;

// 没装经济系统就不扣费
if ($wallet === null) {
    return;
}

$wallet->withdraw($user, 3, 'my-plugin', '功能消耗', 'my-plugin:'.$requestId);
```

想强制依赖，在 manifest 里写 `"requires": { "extensions": { "economy": "^1.0" } }`，
没装时面板会跳过该扩展。希望「装了就用、没装也能跑」就不要声明，用上面的判断。

## 接口

用户（登录后）：

```
GET /api/client/extensions/economy
GET /api/client/extensions/economy/transactions?limit=50&kind=ai-assistant
```

管理端（root admin）：

```
GET   /api/admin/extensions/economy/config
PATCH /api/admin/extensions/economy/config
GET   /api/admin/extensions/economy/users?query=xxx
GET   /api/admin/extensions/economy/users/{id}
POST  /api/admin/extensions/economy/users/{id}/adjust      { amount, description?, reference? }
POST  /api/admin/extensions/economy/users/adjust-batch     { ids, amount, description? }
GET   /api/admin/extensions/economy/users/{id}/transactions
```

第三方（Application API）：

```
GET  /api/application/extensions/economy/users/{id}/balance
POST /api/application/extensions/economy/users/{id}/adjust
```

`amount` 正数入账、负数出账，填 0 会被拒。第三方调用建议始终带 `reference`。

## 后台设置

「管理 > 经济系统」：

| 设置项 | 默认 | 说明 |
| --- | --- | --- |
| 货币名称 | 积分 | 前端显示的名称 |
| 货币符号 | 空 | 显示在数字前面，例如 `¥` |
| 单次调整上限 | 0 | 0 表示不限，防止手滑输入过大的数 |
| 允许透支（扣成负数） | 开 | 只影响账本层：余额可以被预扣成负数。业务上该不该欠钱由各插件自己判断 |

下面按用户名、邮箱或昵称搜用户，可以看余额和流水，也可以手动增减。每次调整都会写一条
`admin` 来源的流水。

## 负数是怎么产生的

账本允许出现负数，但只有一种情况会真的扣成负数：**实际用量超过预扣的估算**。比如按
「输入字符 ÷ 4」估了 3 分，实际生成的内容很长、扣了 8 分，差额就记成负数，用户下次充值自动抵扣。

其余场景都不允许欠钱：购买、续费、升级、换套餐、自动续费、管理员手工扣减、第三方接口扣减，
都会先查余额，不够直接返回 422「余额不足」，不会把用户扣成负数。

## 与计费扩展的关系

原来的 `billing`（计费与积分）现在是 `hosting`（服务器托管），已经改成调这个契约，
不再创建 `ext_billing_balances` 和 `ext_billing_transactions`。它的签到、兑换码、续费、
商城扣费都落进 `ext_economy_transactions`，账户页看到的是一份数据。

从更早版本升上来的话，旧表可以删掉：

```sql
DROP TABLE IF EXISTS ext_billing_transactions;
DROP TABLE IF EXISTS ext_billing_balances;
```

## 安装

```sh
php artisan p:extension:install /path/to/economy.zip --enable
php artisan optimize:clear
```

装好后账户页多出「我的积分」，「管理 > 经济系统」可以配参数、调余额。
`hosting` 与 `ai-assistant` 依赖这个扩展，需要先装它。
