import requests
import json

url = "https://b9f2-172-92-138-155.ngrok-free.app/profile-research"
headers = {
    "Content-Type": "application/json"
}
data = {
    "query": "Key contributors to the development of GPT and transformer architecture",
    "mode": "concise"
}

response = requests.post(url, headers=headers, data=json.dumps(data))

print("Status Code:", response.status_code)
print("Response JSON:", response.json())
