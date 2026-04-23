#!/bin/bash
cd ~/IronLedger

FILES=(
  "app/add-firearm.tsx"
  "app/add-expense.tsx"
  "app/edit-firearm.tsx"
  "app/edit-expense.tsx"
  "app/add-accessory.tsx"
  "app/add-maintenance.tsx"
  "app/edit-accessory.tsx"
  "app/edit-maintenance.tsx"
  "app/add-suppressor.tsx"
  "app/edit-suppressor.tsx"
  "app/dispose.tsx"
  "app/add-ammo.tsx"
  "app/edit-ammo.tsx"
  "app/dope-card.tsx"
  "app/add-session.tsx"
)

for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    sed -i '' 's|</ScrollView>|</FormScrollView>|g' "$f"
    sed -i '' '/KeyboardAvoidingView/d' "$f"
    echo "Fixed $f"
  fi
done

# nfa-trust and battery-log have brackets in path
sed -i '' 's|</ScrollView>|</FormScrollView>|g' "app/nfa-trust/[id].tsx"
sed -i '' '/KeyboardAvoidingView/d' "app/nfa-trust/[id].tsx"
echo "Fixed app/nfa-trust/[id].tsx"

sed -i '' 's|</ScrollView>|</FormScrollView>|g' "app/battery-log/[id].tsx"
sed -i '' '/KeyboardAvoidingView/d' "app/battery-log/[id].tsx"
echo "Fixed app/battery-log/[id].tsx"

# Fix insurance.tsx - line 626 </View> should be </TouchableOpacity>
perl -i -pe 's|</View>|</TouchableOpacity>| if $. == 626' app/insurance.tsx
echo "Fixed app/insurance.tsx"

echo ""
echo "All done! Run: npx expo start"
