#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
간단한 계산기 프로그램
기본 사칙연산을 지원합니다.
"""


def display_menu():
    """계산기 메뉴를 화면에 표시합니다."""
    print("\n" + "=" * 40)
    print("         계산기 프로그램")
    print("=" * 40)
    print("1. 덧셈 (+)")
    print("2. 뺄셈 (-)")
    print("3. 곱셈 (×)")
    print("4. 나눗셈 (÷)")
    print("5. 종료")
    print("=" * 40)


def get_numbers():
    """사용자로부터 두 개의 숫자를 입력받습니다."""
    while True:
        try:
            num1 = float(input("첫 번째 숫자를 입력하세요: "))
            num2 = float(input("두 번째 숫자를 입력하세요: "))
            return num1, num2
        except ValueError:
            print("❌ 올바른 숫자를 입력해주세요!\n")


def add(a, b):
    """덧셈 연산을 수행합니다."""
    return a + b


def subtract(a, b):
    """뺄셈 연산을 수행합니다."""
    return a - b


def multiply(a, b):
    """곱셈 연산을 수행합니다."""
    return a * b


def divide(a, b):
    """나눗셈 연산을 수행합니다.
    
    Args:
        a: 피제수
        b: 제수
        
    Returns:
        나눗셈 결과 또는 None (0으로 나누기 시도 시)
    """
    if b == 0:
        print("❌ 오류: 0으로 나눌 수 없습니다!")
        return None
    return a / b


def calculate(choice, num1, num2):
    """선택한 연산을 수행하고 결과를 반환합니다."""
    operations = {
        '1': (add, '+'),
        '2': (subtract, '-'),
        '3': (multiply, '×'),
        '4': (divide, '÷')
    }
    
    if choice in operations:
        operation, symbol = operations[choice]
        result = operation(num1, num2)
        
        if result is not None:
            print(f"\n✓ 결과: {num1} {symbol} {num2} = {result}")
            return True
    
    return False


def main():
    """메인 함수: 계산기 프로그램을 실행합니다."""
    print("\n환영합니다! 계산기 프로그램을 시작합니다.")
    
    while True:
        display_menu()
        
        choice = input("\n원하는 연산을 선택하세요 (1-5): ").strip()
        
        # 종료 옵션
        if choice == '5':
            print("\n계산기 프로그램을 종료합니다. 감사합니다! 👋")
            break
        
        # 유효한 선택인지 확인
        if choice not in ['1', '2', '3', '4']:
            print("❌ 잘못된 선택입니다. 1-5 사이의 숫자를 입력해주세요.")
            continue
        
        # 숫자 입력 받기
        num1, num2 = get_numbers()
        
        # 계산 수행
        calculate(choice, num1, num2)
        
        # 계속 진행 여부 확인
        continue_choice = input("\n계속 계산하시겠습니까? (y/n): ").strip().lower()
        if continue_choice == 'n':
            print("\n계산기 프로그램을 종료합니다. 감사합니다! 👋")
            break


if __name__ == "__main__":
    main()
