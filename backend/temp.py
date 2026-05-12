from hedera import Client, TopicCreateTransaction
from hedera import AccountId, PrivateKey

client = Client.forTestnet()

client.setOperator(
    AccountId.fromString("id"),
    PrivateKey.fromString("key")
)

tx = TopicCreateTransaction().execute(client)
receipt = tx.getReceipt(client)

print("Your Topic ID:", receipt.topicId.toString())