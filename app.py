from fastapi import FastAPI

from vercel_app import app as unifund_app

app = FastAPI()
app.mount("/", unifund_app)
