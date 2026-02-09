FROM python:3.10-slim

WORKDIR /app

RUN pip install --no-cache-dir \
    tensorflow==2.15.0 \
    keras==2.15.0 \
    numpy \
    pandas \
    scikit-learn \
    fastapi \
    uvicorn

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4003"]
