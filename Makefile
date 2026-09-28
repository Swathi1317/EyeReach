.PHONY: install run test

install:
	pip install -r backend/requirements.txt

run:
	uvicorn backend.app.main:app --reload

test:
	pytest tests/
