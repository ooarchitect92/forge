UPDATE subscription_plans
SET "aiCreditLimit" = 30, "updatedAt" = now()
WHERE slug = 'free' AND price = 0 AND "aiCreditLimit" = 0;
